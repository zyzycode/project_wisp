import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ManagedLocalAIBackend, type ManagedAIChild } from '../../src/infrastructure/platform/managed-local-ai-backend';
import { localAIChildEnvironment, parseLocalAIReady, probeLocalAIHealth } from '../../src/infrastructure/platform/local-ai-backend-protocol';
const bootstrap = { apiKey: 'synthetic-key', sessionToken: 'a'.repeat(64), ledgerPath: '/trusted/user-data/ledger.sqlite' };
function fixture(health = vi.fn(async () => true)) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn(() => true) }) satisfies ManagedAIChild;
  const spawn = vi.fn(() => child), onUnavailable = vi.fn();
  const backend = new ManagedLocalAIBackend({ python: '/trusted/python', directory: '/trusted/backend', spawn,
    validateRuntime: async () => true, health, onUnavailable, env: { HOME: '/home/test', OPENAI_API_KEY: 'do-not-inherit', WISP_AI_PROVIDER: 'wrong' } });
  return { child, spawn, onUnavailable, backend, health };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('managed local child', () => {
  it('bootstraps privately and accepts only authenticated local health without a provider call', async () => {
    const f = fixture(); const starting = f.backend.start(bootstrap); await Promise.resolve();
    expect(f.spawn).toHaveBeenCalledWith('/trusted/python', '/trusted/backend', expect.not.objectContaining({ OPENAI_API_KEY: expect.anything() }));
    expect(String(f.child.stdin.read())).toBe(`${JSON.stringify(bootstrap)}\n`);
    f.child.stdout?.emit('data', Buffer.from('{"kind":"ready","port":43123}\n'));
    expect(await starting).toEqual({ ok: true, port: 43123 });
    expect(f.health).toHaveBeenCalledWith(43123, bootstrap.sessionToken, expect.any(AbortSignal));
    const stop = f.backend.stop(); f.child.emit('exit', 0); await stop;
  });
  it('times out startup and never accepts late readiness', async () => {
    const f = fixture(); const result = f.backend.start(bootstrap); await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toEqual({ ok: false, code: 'startup_timeout' });
    f.child.stdout?.emit('data', Buffer.from('{"kind":"ready","port":43123}\n'));
    expect(f.health).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.child.kill).toHaveBeenCalledWith('SIGKILL');
  });
  it('bounds health to one second and rejects EOF before ready', async () => {
    const f = fixture(vi.fn(() => new Promise<boolean>(() => undefined)));
    const started = f.backend.start(bootstrap); await Promise.resolve();
    f.child.stdout?.emit('data', Buffer.from('{"kind":"ready","port":43123}\n'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await started).toEqual({ ok: false, code: 'startup_failed' });
    const g = fixture(); const other = g.backend.start(bootstrap); await Promise.resolve(); g.child.stdout?.emit('end');
    expect(await other).toEqual({ ok: false, code: 'startup_failed' });
    await vi.advanceTimersByTimeAsync(3000);
  });
  it('stops only its own process within three seconds, escalating after graceful EOF', async () => {
    const f = fixture(); const started = f.backend.start(bootstrap); await Promise.resolve();
    f.child.stdout?.emit('data', Buffer.from('{"kind":"ready","port":43123}\n')); await started;
    const stop = f.backend.stop();
    expect(f.child.stdin?.writableEnded).toBe(true);
    await vi.advanceTimersByTimeAsync(500); expect(f.child.kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(1500); expect(f.child.kill).toHaveBeenCalledWith('SIGKILL');
    await vi.advanceTimersByTimeAsync(1000); await stop;
    expect(f.spawn).toHaveBeenCalledOnce();
  });
  it('marks an exited ready child unavailable without restarting', async () => {
    const f = fixture(); const started = f.backend.start(bootstrap); await Promise.resolve();
    f.child.stdout?.emit('data', Buffer.from('{"kind":"ready","port":43123}\n')); await started;
    f.child.emit('exit', 1);
    expect(f.onUnavailable).toHaveBeenCalledOnce(); expect(f.spawn).toHaveBeenCalledOnce();
  });
  it('does not search PATH for a runtime', async () => {
    const spawn = vi.fn(); const backend = new ManagedLocalAIBackend({ python: 'python', directory: '/trusted/backend', spawn });
    expect(await backend.start(bootstrap)).toEqual({ ok: false, code: 'runtime_unavailable' });
    expect(spawn).not.toHaveBeenCalled();
  });
});
describe('private local protocol', () => {
  it.each(['{"kind":"ready","port":1,"port":2}\n', '{"kind":"ready","port":0}\n', '{"kind":"ready","port":1}\nextra', 'x'.repeat(257)])('rejects invalid or surplus stdout', text => {
    expect(() => parseLocalAIReady(Buffer.from(text))).toThrow('Invalid backend readiness');
  });
  it('does not forward inherited credentials or provider overrides', () => {
    expect(localAIChildEnvironment({ HOME: '/home/test', OPENAI_API_KEY: 'secret', WISP_BACKEND_URL: 'http://example', PYTHONPATH: '/evil' })).toEqual({ HOME: '/home/test', PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' });
  });
  it('requires health status and bounded JSON; refuses redirects and credentials', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{"status":"ok"}', { headers: { 'content-type': 'application/json' } }));
    expect(await probeLocalAIHealth(4321, bootstrap.sessionToken, new AbortController().signal, fetcher)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:4321/health', expect.objectContaining({ headers: { Authorization: `Bearer ${bootstrap.sessionToken}`, Accept: 'application/json' }, redirect: 'error', credentials: 'omit' }));
    fetcher.mockResolvedValue(new Response(' '.repeat(16385), { headers: { 'content-type': 'application/json' } }));
    expect(await probeLocalAIHealth(4321, bootstrap.sessionToken, new AbortController().signal, fetcher)).toBe(false);
  });
});
