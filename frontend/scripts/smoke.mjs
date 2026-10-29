import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, release } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { bounded, exitStatus, smokeEnvironment, stopOwnedProcess } from './smoke-support.mjs';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(frontend, 'package.json'));
const output = path.resolve(process.argv[2] || path.join(tmpdir(), `wisp-smoke-${Date.now()}`));
const profile = await mkdtemp(path.join(tmpdir(), 'wisp-smoke-profile-'));
await mkdir(output, { recursive: true });
const environment = smokeEnvironment(process.env, profile, output);
const runId = randomUUID();
environment.WISP_SMOKE_RUN_ID = runId;
const report = { commit: 'unknown',
  runId, platform: process.platform, osRelease: release(), session: process.env.XDG_SESSION_TYPE || process.platform,
  virtualDisplay: process.env.WISP_SMOKE_VIRTUAL_DISPLAY === 'true', checks: [] };
let server, httpServer, child, closed;
let status = 1;
let log = '';
const controller = new AbortController();
const abort = () => { controller.abort(); stopOwnedProcess(child); };
const run = (promise, duration, label) => bounded(promise, duration, label, controller.signal);
process.on('SIGINT', abort);
process.on('SIGTERM', abort);
try {
  report.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: frontend, encoding: 'utf8', timeout: 5000 }).trim();
  report.dirty = execFileSync('git', ['status', '--porcelain'], { cwd: frontend, encoding: 'utf8', timeout: 5000 }).trim().length > 0;
  if (process.platform === 'linux' && !environment.DISPLAY && !environment.WAYLAND_DISPLAY) {
    report.checks.push({ name: 'desktop-session', status: 'NOT RUN', detail: 'No DISPLAY or WAYLAND_DISPLAY' });
    throw new Error('Desktop session required');
  }
  // Vite's ordinary dev compiler, with test-owned startup instead of plugin startup flags.
  const { createServer } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const { build: compileElectron } = await import('vite-plugin-electron');
  // Middleware mode leaves signal/exit ownership with this runner, not Vite's SIGTERM handler.
  httpServer = createHttpServer();
  server = await createServer({ configFile: false, root: frontend, envDir: false,
    server: { middlewareMode: true, hmr: { server: httpServer } }, plugins: [react()] });
  httpServer.on('request', server.middlewares);
  controller.signal.throwIfAborted();
  await run(new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  }), 30_000, 'Vite startup');
  await run(compileElectron({
    entry: { index: 'src/main/index.ts', 'memory-worker': 'src/infrastructure/memory/worker.ts', 'voice-worker': 'src/infrastructure/voice/worker.ts', 'speech-worker': 'src/infrastructure/voice-output/worker.ts', 'voice-smoke': 'tests/smoke/voice-fixture.ts' },
    vite: { root: frontend, mode: 'development', envDir: false,
      build: { outDir: 'dist-electron/main', minify: false,
        rolldownOptions: { external: ['electron', 'better-sqlite3', '@huggingface/transformers', 'onnxruntime-node', /^node:/] } } },
  }), 60_000, 'Main dev compilation');
  controller.signal.throwIfAborted();
  await run(compileElectron({
    entry: 'src/preload/index.ts', vite: { root: frontend, mode: 'development', envDir: false,
      build: { outDir: 'dist-electron/preload', minify: false,
        rolldownOptions: { external: ['electron'], output: { format: 'cjs', codeSplitting: false, entryFileNames: 'index.js' } } } },
  }), 60_000, 'Preload dev compilation');
  environment.VITE_DEV_SERVER_URL = `http://127.0.0.1:${httpServer.address().port}/`;
  controller.signal.throwIfAborted();
  child = spawn(require('electron'), [path.join(frontend, 'tests/smoke/electron.cjs')], {
    cwd: frontend, env: environment, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Only bounded diagnostic output from the isolated, mock-only profile is retained.
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log = (log + data).slice(-32_768); });
  closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const code = await run(closed, 60_000, 'Electron smoke');
  const native = JSON.parse(await readFile(path.join(output, 'electron.json'), 'utf8'));
  if (native.runId !== runId) throw new Error('Missing current Electron receipt (old output directory)');
  Object.assign(report, native);
  status = exitStatus(report, code);
} catch (error) {
  report.checks.push({ name: 'runner', status: 'FAIL', detail: error.message });
} finally {
  const cleanup = async (name, action) => {
    try { await bounded(Promise.resolve().then(action), 5000, name); }
    catch (error) { report.checks.push({ name, status: 'FAIL', detail: error.message }); status = 1; }
  };
  await cleanup('process-cleanup', async () => {
    stopOwnedProcess(child);
    if (closed) {
      try { await bounded(closed, 3000, 'Electron exit'); }
      catch (error) { stopOwnedProcess(child, 'SIGKILL'); throw error; }
    }
  });
  await cleanup('server-cleanup', () => server?.close());
  await cleanup('http-cleanup', () => new Promise((resolve, reject) => {
    if (!httpServer?.listening) { resolve(); return; }
    httpServer.close(error => error ? reject(error) : resolve());
    httpServer.closeAllConnections();
  }));
  await cleanup('profile-cleanup', () => rm(profile, { recursive: true, force: true }));
  if (controller.signal.aborted) {
    report.checks.push({ name: 'interrupted', status: 'FAIL' });
    status = 1;
  }
  await writeFile(path.join(output, 'electron.log'), log);
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  for (const check of report.checks) console.log(`${check.status}: ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
  console.log(`Smoke report: ${path.join(output, 'report.json')}`);
  process.removeListener('SIGINT', abort);
  process.removeListener('SIGTERM', abort);
  process.exitCode = status;
  // The outer launcher must not hang on a failed compiler/server cleanup.
  if (status !== 0) process.exit(status);
}
