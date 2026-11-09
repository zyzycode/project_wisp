import { ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WindowsWindowSurfaces } from '../../src/infrastructure/platform/windows-window-surfaces';
import { serializeFocusCommand, parseFocusBridgeResponse } from '../../src/infrastructure/platform/window-focus-protocol';
const attempt = 'a'.repeat(32), nonce = 'b'.repeat(32), token = 'c'.repeat(32);
const prepare = { action: 'prepare' as const, attempt, target: { token, signature: 'geometry', x: -100, y: 20, width: 600, height: 400 } };
function fixture() {
  const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough();
  const stdio: ChildProcessWithoutNullStreams['stdio'] = [stdin, stdout, stderr, undefined, undefined];
  const child = Object.assign(new ChildProcess(), { stdin, stdout, stderr, stdio });
  vi.spyOn(child, 'kill').mockReturnValue(true);
  const writes: string[] = []; child.stdin.on('data', data => writes.push(String(data)));
  const spawn = vi.fn(() => child);
  const port = new WindowsWindowSurfaces({ now: Date.now, spawn, ownProcessIds: () => [42], normalize: () => [] });
  const send = (data: unknown) => child.stdout.write(JSON.stringify(data) + '\n');
  send({ ready: true }); send({ requestId: 1, windows: [] });
  return { port, child, writes, spawn, send };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); });
afterEach(() => vi.useRealTimers());
it('serializes observation/prepare/commit on one helper without exposing native identity', async () => {
  const f = fixture(), signal = new AbortController().signal;
  const prepared = f.port.exchangeFocus(prepare, signal);
  expect(f.writes).toEqual(['1 42\n', `P 2 ${attempt} ${token} -100 20 600 400\n`]);
  f.send({ requestId: 2, action: 'prepare', status: 'prepared', preparedId: nonce });
  expect(await prepared).toEqual({ status: 'prepared', preparedId: nonce });
  const committed = f.port.exchangeFocus({ action: 'commit', attempt, nonce, token }, signal);
  f.send({ requestId: 3, action: 'commit', status: 'success', effect: 'focus_observed' });
  expect(await committed).toEqual({ status: 'success', effect: 'focus_observed' }); expect(f.spawn).toHaveBeenCalledOnce();
  expect(f.port.getSnapshot()).toMatchObject({ capability: 'available', capturedAtMs: 1000 }); f.port.dispose();
});
it('queues one action behind an existing sample, and cancellation before dispatch writes no action', async () => {
  const f = fixture(), controller = new AbortController(); await vi.advanceTimersByTimeAsync(100);
  const action = f.port.exchangeFocus(prepare, controller.signal); const rejected = expect(action).rejects.toThrow(); controller.abort(); await rejected;
  expect(f.writes).toEqual(['1 42\n', '2 42\n']);
  f.send({ requestId: 2, windows: [] }); await vi.advanceTimersByTimeAsync(100); expect(f.writes).toHaveLength(3); expect(f.writes.some(line => line.startsWith('P '))).toBe(false); f.port.dispose();
});
it('abort or malformed response after dispatch kills identity epoch and ignores a late successful receipt', async () => {
  const f = fixture(), controller = new AbortController(), epoch = f.port.actionGeneration();
  const action = f.port.exchangeFocus(prepare, controller.signal), rejected = expect(action).rejects.toThrow(); controller.abort(); await rejected;
  expect(f.child.kill).toHaveBeenCalledOnce(); expect(f.port.actionGeneration()).toBeGreaterThan(epoch);
  f.send({ requestId: 2, action: 'prepare', status: 'prepared', preparedId: nonce }); expect(f.port.getSnapshot().capability).toBe('unavailable'); f.port.dispose();
});
it('times out a nonresponsive action within the existing helper deadline and removes timers on disposal', async () => {
  const f = fixture(), action = f.port.exchangeFocus(prepare, new AbortController().signal), rejected = expect(action).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(250); await rejected; expect(f.child.kill).toHaveBeenCalledOnce(); f.port.dispose(); expect(vi.getTimerCount()).toBe(0);
});
it('rejects native identifiers, model/title commands and arbitrary private protocol text', () => {
  expect(() => serializeFocusCommand({ ...prepare, attempt: 'title; powershell' }, 1)).toThrow();
  expect(() => serializeFocusCommand({ ...prepare, target: { ...prepare.target, x: Infinity } }, 1)).toThrow();
  expect(() => parseFocusBridgeResponse({ requestId: 2, action: 'commit', status: 'success', effect: 'focus_observed', hwnd: '1' }, 2, 'commit')).toThrow();
  expect(() => parseFocusBridgeResponse({ requestId: 2, action: 'prepare', status: 'success', effect: 'focus_observed' }, 2, 'prepare')).toThrow();
});
