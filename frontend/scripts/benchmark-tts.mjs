import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

// Explicit developer probe: no provider, microphone, playback, runtime download or audio files.
const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(frontend, 'package.json'));
const threads = process.argv[2] || '2';
const spinning = process.argv[3] || '1';
const suite = process.argv[4] || 'short';
if (!['1', '2', '4', '8'].includes(threads) || !['0', '1'].includes(spinning) || !['short', 'full'].includes(suite)) {
  throw new Error('Usage: node frontend/scripts/benchmark-tts.mjs [1|2|4|8] [0|1 spinning] [short|full]');
}
const temporary = await mkdtemp(path.join(tmpdir(), 'wisp-tts-benchmark-'));
try {
  const entry = path.join(temporary, 'probe.mjs');
  await build({ input: path.join(frontend, 'tests/voice-output/performance-runner.ts'),
    external: id => !id.startsWith('.') && !id.startsWith('/'),
    output: { file: entry, format: 'esm', paths: id => id.startsWith('node:') ? id : require.resolve(id) } });
  const environment = { ORT_DISABLE_TELEMETRY: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' };
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH']) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  const child = fork(entry, [path.join(frontend, '.cache/voice-models'), threads, spinning, suite], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: environment,
  });
  let ticks = 0, maxGapMs = 0, previous = performance.now();
  const heartbeat = setInterval(() => { const now = performance.now(); maxGapMs = Math.max(maxGapMs, now - previous); previous = now; ticks++; }, 10);
  let timedOut = false;
  const expire = () => { timedOut = true; child.kill('SIGKILL'); };
  let deadline = setTimeout(expire, 120_000);
  const stop = () => child.kill('SIGKILL');
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  child.on('message', value => {
    if (!value || typeof value !== 'object' || !('phase' in value)) return;
    clearTimeout(deadline); deadline = setTimeout(expire, 120_000);
    console.log(JSON.stringify(value));
  });
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    console.log(JSON.stringify({ phase: 'parent', scope: 'standalone-node-parent', ticks, maxGapMs, timedOut, exitCode: code }));
    process.exitCode = code === 0 && !timedOut ? 0 : 1;
  } finally {
    clearTimeout(deadline); clearInterval(heartbeat); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
