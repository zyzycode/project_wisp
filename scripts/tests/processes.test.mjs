import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import test from 'node:test';
import { runProcesses } from '../processes.mjs';
import { backendCommand, devCommands, frontendCommand, wispCommands } from '../commands.mjs';

const specs = [{ name: 'backend', command: 'python', args: [] }, { name: 'frontend', command: 'node', args: [] }];

function fixture() {
  const children = [];
  const stopped = [];
  const spawnProcess = () => {
    const child = new EventEmitter();
    children.push(child);
    return child;
  };
  const stop = child => {
    stopped.push(child);
    queueMicrotask(() => child.emit('close', null));
  };
  return { children, stopped, spawnProcess, stop };
}

test('a failed component stops its sibling and fails the combined command', async () => {
  const f = fixture();
  const run = runProcesses(specs, f);
  f.children[0].emit('close', 2);
  assert.equal(await run, 2);
  assert.ok(f.stopped.includes(f.children[1]));
});

test('Ctrl+C stops both owned children and allows clean shutdown', async () => {
  const f = fixture();
  const controller = new AbortController();
  const run = runProcesses(specs, { ...f, signal: controller.signal });
  controller.abort();
  assert.equal(await run, 0);
  assert.equal(f.stopped.length, 2);
});

test('a missing executable stops the sibling and reports failure', async () => {
  const f = fixture();
  const run = runProcesses(specs, f);
  f.children[0].emit('error', new Error('ENOENT'));
  assert.equal(await run, 1);
  assert.ok(f.stopped.includes(f.children[1]));
});

test('pre-aborted launch creates no processes', async () => {
  const f = fixture();
  assert.equal(await runProcesses(specs, { ...f, signal: AbortSignal.abort() }), 0);
  assert.equal(f.children.length, 0);
});

test('backend port and interpreter are explicit; frontend uses the same endpoint', () => {
  const env = { WISP_BACKEND_PORT: '8001', WISP_PYTHON: 'custom-python', WISP_BACKEND_URL: 'http://wrong-server' };
  const [backend, frontend] = devCommands(env);
  assert.equal(backend.command, 'custom-python');
  assert.equal(backend.args.at(-1), '8001');
  assert.equal(frontend.env.WISP_BACKEND_URL, 'http://127.0.0.1:8001');
  assert.equal(frontend.env.WISP_BACKEND_API_VERSION, '1');
  assert.equal(frontend.env.WISP_AI_EVENTS_ENABLED, 'false');
});

test('invalid ports and modes fail before spawning', () => {
  for (const port of ['0', '65536', '8000;echo', 'NaN']) {
    assert.throws(() => backendCommand('dev', { WISP_BACKEND_PORT: port }), /WISP_BACKEND_PORT/u);
  }
  assert.throws(() => backendCommand('unknown', {}), /Unknown backend command/u);
});

test('server credentials and profile configuration are not inherited by desktop', () => {
  const [backend, frontend] = devCommands({ GROQ_API_KEY: 'server-key', token_api: 'legacy-key',
    GEMINI_API_KEY: 'gemini-key', gemini_api_key: 'lowercase-key',
    OPENAI_API_KEY: 'openai-key', openai_api_key: 'lowercase-openai-key',
    WISP_AI_PROVIDER: 'gemini', WISP_AI_MODEL: 'gemini-3.5-flash-lite',
    WISP_AI_BASE_URL: 'https://example.com/', WISP_AI_MAX_OUTPUT_TOKENS: '512',
    WISP_AI_TEMPERATURE: '0.5', WISP_AI_THINKING_LEVEL: 'low',
    WISP_AI_REQUEST_TIMEOUT: '8', WISP_AI_CONNECT_TIMEOUT: '2', WISP_AI_POOL_TIMEOUT: '1',
    ASSISTANTS_JSON: '{}', WISP_UPSTREAM_TRUST_ENV: 'true', PATH: 'host-path' });
  assert.equal(backend.env.GROQ_API_KEY, 'server-key');
  assert.equal(backend.env.GEMINI_API_KEY, 'gemini-key');
  assert.equal(backend.env.OPENAI_API_KEY, 'openai-key');
  assert.equal(frontend.env.PATH, 'host-path');
  for (const key of ['GROQ_API_KEY', 'token_api', 'GEMINI_API_KEY', 'gemini_api_key',
    'OPENAI_API_KEY', 'openai_api_key',
    'WISP_AI_PROVIDER', 'WISP_AI_MODEL', 'WISP_AI_BASE_URL', 'WISP_AI_MAX_OUTPUT_TOKENS',
    'WISP_AI_TEMPERATURE', 'WISP_AI_THINKING_LEVEL', 'WISP_AI_REQUEST_TIMEOUT',
    'WISP_AI_CONNECT_TIMEOUT', 'WISP_AI_POOL_TIMEOUT', 'ASSISTANTS_JSON', 'WISP_UPSTREAM_TRUST_ENV']) {
    assert.equal(Object.hasOwn(frontend.env, key), false);
  }
});

test('frontend test filters are passed as literal arguments without a shell', () => {
  const spec = frontendCommand('test', ['tests/main/example.test.ts', '--reporter=dot']);
  assert.deepEqual(spec.args.slice(-3), ['--', 'tests/main/example.test.ts', '--reporter=dot']);
  assert.ok(spec.cwd.endsWith('frontend'));
});

test('combined verification stops between each independently owned stage', () => {
  const stages = wispCommands('test');
  assert.deepEqual(stages.map(stage => stage.name), ['tooling', 'frontend', 'frontend', 'backend', 'backend']);
  assert.throws(() => wispCommands('unknown'), /Unknown Wisp command/u);
});
