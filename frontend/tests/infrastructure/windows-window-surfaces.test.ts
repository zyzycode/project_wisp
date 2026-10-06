import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WindowsWindowSurfaces } from '../../src/infrastructure/platform/windows-window-surfaces';

function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
  });
  const writes: string[] = [];
  child.stdin.on('data', chunk => writes.push(String(chunk)));
  const spawn = vi.fn(() => child as unknown as ChildProcessWithoutNullStreams);
  const port = new WindowsWindowSurfaces({ now: Date.now, spawn, ownProcessIds: () => [42], normalize: () => Object.freeze([]) });
  const send = (value: unknown) => child.stdout.write(JSON.stringify(value) + '\n');
  return { port, child, spawn, writes, send };
}
afterEach(() => vi.useRealTimers());
describe('Windows observation lifecycle', () => {
  it('waits for compilation, timestamps request start and limits polling to 10 Hz', () => {
    const f = fixture();
    expect(f.writes).toEqual([]);
    f.send({ ready: true });
    vi.advanceTimersByTime(80);
    expect(f.writes).toEqual(['1 42\n']);
    f.send({ requestId: 1, windows: [] });
    const snapshot = f.port.getSnapshot();
    expect(snapshot).toMatchObject({ capability: 'available', capturedAtMs: 1000, revision: 1 });
    vi.advanceTimersByTime(19);
    expect(f.port.getSnapshot()).toBe(snapshot);
    expect(f.writes).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(f.writes).toHaveLength(2);
    f.port.dispose();
  });
  it('times out a single in-flight request, invalidates and restarts once', () => {
    const f = fixture(); f.send({ ready: true });
    vi.advanceTimersByTime(249);
    expect(f.writes).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(f.port.getSnapshot()).toMatchObject({ capability: 'unavailable', reason: 'bridge_failed' });
    expect(f.child.kill).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(f.spawn).toHaveBeenCalledTimes(2);
    f.port.dispose();
    vi.advanceTimersByTime(20000);
    expect(f.spawn).toHaveBeenCalledTimes(2);
  });
  it.each([{ requestId: 2, windows: [] }, { requestId: 1, windows: [], pid: 42 }])('rejects mismatched or private metadata', message => {
    const f = fixture(); f.send({ ready: true }); f.send(message);
    expect(f.port.getSnapshot().capability).toBe('unavailable');
    expect(f.child.kill).toHaveBeenCalledOnce(); f.port.dispose();
  });
  it('invalidates stale or negative-age cached observations without refreshing their time', () => {
    const f = fixture(); f.send({ ready: true }); f.send({ requestId: 1, windows: [] });
    vi.setSystemTime(1301);
    expect(f.port.getSnapshot()).toMatchObject({ reason: 'stale', capturedAtMs: 1000, revision: 2 });
    f.port.dispose();
    const g = fixture(); g.send({ ready: true }); g.send({ requestId: 1, windows: [] });
    vi.setSystemTime(999);
    expect(g.port.getSnapshot()).toMatchObject({ reason: 'stale', capturedAtMs: 1000 }); g.port.dispose();
  });
  it('kills the helper on topology changes and ignores late output', () => {
    const f = fixture(); f.send({ ready: true }); f.port.invalidate();
    f.send({ requestId: 1, windows: [] });
    expect(f.port.getSnapshot().capability).toBe('unavailable'); f.port.dispose();
  });
});
