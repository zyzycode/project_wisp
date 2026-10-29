import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bounded, exitStatus, smokeEnvironment, stopOwnedProcess } from '../../frontend/scripts/smoke-support.mjs';
import { wispCommands } from '../commands.mjs';

test('smoke launcher forwards a literal output path to the isolated runner', () => {
  const [command] = wispCommands('smoke:desktop', ['output folder']);
  assert.deepEqual(command.args.slice(-3), ['smoke:desktop', '--', 'output folder']);
});

test('profile cannot inherit AI routes, credentials, debugging or sandbox bypass flags', () => {
  const env = smokeEnvironment({ PATH: '/tools', DISPLAY: ':0', OPENAI_API_KEY: 'secret',
    WISP_BACKEND_URL: 'https://provider', ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_DISABLE_WEB_SECURITY: 'true', REMOTE_DEBUGGING_PORT: '9222', VITE_OTHER: 'private' }, '/temp', '/report');
  assert.deepEqual(env, { PATH: '/tools', DISPLAY: ':0', WISP_SMOKE_PROFILE: '/temp',
    WISP_SMOKE_OUTPUT: '/report', WISP_AI_EVENTS_ENABLED: 'false', WISP_SUMMARY_ENABLED: 'false' });
});

test('failure or missing quit receipt cannot produce a passing smoke', () => {
  const receipt = { name: 'application-quit', status: 'PASS' };
  assert.equal(exitStatus({ checks: [receipt] }, 0), 0);
  assert.equal(exitStatus({ checks: [receipt] }, 1), 1);
  assert.equal(exitStatus({ checks: [{ name: 'desktop-session', status: 'NOT RUN' }] }, 0), 1);
  assert.equal(exitStatus({ checks: [receipt, { name: 'renderer', status: 'FAIL' }] }, 0), 1);
});

test('deadline and interruption reject pending work before continuation can launch Electron', async () => {
  await assert.rejects(bounded(new Promise(() => {}), 10, 'startup'), /startup timeout/);
  const controller = new AbortController();
  let continued = false;
  const run = bounded(new Promise(() => {}), 1000, 'compile', controller.signal).then(() => { continued = true; });
  controller.abort();
  await assert.rejects(run, /compile aborted/);
  assert.equal(continued, false);
  await assert.rejects(bounded(new Promise(() => {}), 1000, 'start', controller.signal), /start aborted/);
});

test('timed-out owned process is stopped and reaped', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    detached: process.platform !== 'win32', stdio: 'ignore',
  });
  const closed = once(child, 'close');
  await once(child, 'spawn');
  try { await assert.rejects(bounded(closed, 20, 'child'), /child timeout/); }
  finally { stopOwnedProcess(child); await bounded(closed, 5000, 'cleanup'); }
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

for (const routed of [false, true]) test(`SIGTERM during actual dev compilation writes failure report (${routed ? 'root launcher' : 'direct runner'})`, {
  skip: process.platform === 'win32' ? 'Windows kill is forced termination, not POSIX SIGTERM delivery' : false,
}, async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'wisp-smoke-abort-test-'));
  const runner = fileURLToPath(new URL(routed ? '../wisp.mjs' : '../../frontend/scripts/smoke.mjs', import.meta.url));
  const child = spawn(process.execPath, [runner, ...(routed ? ['smoke:desktop'] : []), output], {
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}`,
      DISPLAY: process.env.DISPLAY || ':smoke-abort-before-launch' },
    detached: true, stdio: ['ignore', 'pipe', 'ignore'],
  });
  const closed = once(child, 'close');
  let sent = false;
  child.stdout.on('data', data => {
    if (!sent && data.toString().includes('vite v')) { sent = true; child.kill('SIGTERM'); }
  });
  try {
    const [code] = await bounded(closed, 15_000, 'SIGTERM integration');
    assert.equal(sent, true);
    assert.equal(code, 1);
    const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'));
    assert.ok(report.checks.some(check => check.name === 'interrupted' && check.status === 'FAIL'));
    await assert.rejects(readFile(path.join(output, 'electron.json')), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(output, 'electron.log'), 'utf8'), '');
  } finally {
    stopOwnedProcess(child, 'SIGKILL');
    await rm(output, { recursive: true, force: true });
  }
});
