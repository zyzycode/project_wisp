import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const temporary = await mkdtemp(path.join(tmpdir(), 'wisp-stt-benchmark-'));
const environment = { ORT_DISABLE_TELEMETRY: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' };
for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH']) {
  if (process.env[name] !== undefined) environment[name] = process.env[name];
}
let active;
const stop = () => active?.kill('SIGKILL');
process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  const entry = path.join(temporary, 'probe.mjs');
  await build({ input: path.join(root, 'tests/voice/stt-performance-runner.ts'),
    external: id => !id.startsWith('.') && !id.startsWith('/'),
    output: { file: entry, format: 'esm', paths: id => id.startsWith('node:') ? id : require.resolve(id) } });
  const run = (args, input) => new Promise((resolve, reject) => {
    const child = fork(entry, [path.join(root, '.cache/voice-models'), ...args], {
      env: environment, serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    active = child;
    let fixtures;
    const deadline = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('message', value => {
      if (value?.phase === 'fixtures') fixtures = value.fixtures; // PCM stays in memory, never stdout/files.
      else if (value?.phase) console.log(JSON.stringify(value));
    });
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(deadline); active = undefined; if (code === 0) resolve(fixtures); else reject(new Error('STT probe failed or timed out')); });
    if (input) child.send(input);
  });
  const fixtures = await run(['fixtures']);
  if (!fixtures) throw new Error('Synthetic fixtures unavailable');
  for (const threads of [1, 2, 4, 8]) for (const spinning of [1, 0]) await run(['stt', String(threads), String(spinning)], fixtures);
} finally {
  stop(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  await rm(temporary, { recursive: true, force: true });
}
