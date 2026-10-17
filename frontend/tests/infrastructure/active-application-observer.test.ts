import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveApplicationObserver } from '../../src/infrastructure/platform/active-application-observer';
import type { ObservationPolicy } from '../../src/application/ports/active-application-observation.port';

const application = { appKey: 'key', alias: 'Editor', category: 'editor', excluded: false } as const;
const policy: ObservationPolicy = { generation: 1, active: true, applications: [application] };
function fixture(unsupported = false) {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const children: ReturnType<typeof makeChild>[] = [];
  const spawn = vi.fn(() => { const child = makeChild(); children.push(child); return child; });
  const port = new ActiveApplicationObserver({ now: Date.now, spawn, unsupported, ownProcessIds: () => [42],
    resolvePolicy: value => value.applications.map(entry => ({ ...entry, path: 'C:\\Tools\\editor.exe' })) });
  const send = (value: unknown) => children.at(-1)!.stdout.write(`${JSON.stringify(value)}\n`);
  const available = (id = 1, overrides: object = {}) => send({ id, available: true, appKey: 'key',
    episodeToken: 'episode', sourceToken: 'source', appName: 'editor', windowTitle: 'Document', ...overrides });
  return { port, spawn, children, send, available };
}
function makeChild() {
  const writes: string[] = [];
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), writes,
  });
  child.stdin.on('data', chunk => writes.push(String(chunk)));
  return child;
}
afterEach(() => vi.useRealTimers());
describe('active application lifecycle', () => {
  it('collects nothing until consent and nonempty allowlist; unsupported never starts', () => {
    const f = fixture(); expect(f.spawn).not.toHaveBeenCalled();
    f.port.replacePolicy({ ...policy, active: false }); f.port.replacePolicy({ ...policy, applications: [] });
    f.port.replacePolicy({ ...policy, applications: [{ ...application, excluded: true }] });
    expect(f.spawn).not.toHaveBeenCalled(); f.port.dispose();
    const g = fixture(true); g.port.replacePolicy(policy); expect(g.spawn).not.toHaveBeenCalled();
    expect(g.port.getSnapshot()).toMatchObject({ reason: 'unsupported' }); g.port.dispose();
  });
  it('waits for ready, timestamps request start, emits immutable samples and polls at most 1Hz', () => {
    const f = fixture(); f.port.replacePolicy(policy); const child = f.children[0]!;
    expect(child.writes).toEqual([]); f.send({ ready: true });
    vi.advanceTimersByTime(400); f.available();
    const snapshot = f.port.getSnapshot(); expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot).toMatchObject({ capability: 'available', capturedAtMs: 1000, policyGeneration: 1, category: 'editor' });
    expect(JSON.parse(child.writes[0]!)).toMatchObject({ entries: [{ appKey: 'key', path: 'C:\\Tools\\editor.exe' }], ownProcessIds: [42] });
    vi.advanceTimersByTime(599); expect(child.writes).toHaveLength(1);
    vi.advanceTimersByTime(1); expect(child.writes).toHaveLength(2); f.available(2);
    expect(f.port.getSnapshot()).toMatchObject({ capturedAtMs: 2000 }); f.port.dispose();
  });
  it.each([500, 10_000])('stops on request/startup deadline %i and never restarts automatically', deadline => {
    const f = fixture(); f.port.replacePolicy(policy); if (deadline === 500) f.send({ ready: true });
    vi.advanceTimersByTime(deadline); expect(f.port.getSnapshot()).toMatchObject({ reason: 'bridge_failed' });
    expect(f.children[0]!.kill).toHaveBeenCalledOnce(); vi.advanceTimersByTime(60_000);
    expect(f.spawn).toHaveBeenCalledOnce(); f.available(); expect(f.port.getSnapshot().capability).toBe('unavailable');
    f.port.replacePolicy({ ...policy, generation: 2 }); expect(f.spawn).toHaveBeenCalledTimes(2); f.port.dispose();
  });
  it('retains generation at pause, ignores late output, supports explicit resume and terminal disposal', () => {
    const f = fixture(); f.port.replacePolicy(policy); f.send({ ready: true }); f.available();
    f.port.pause(); expect(f.port.getSnapshot()).toMatchObject({ reason: 'paused', policyGeneration: 1 });
    f.available(2); expect(f.port.getSnapshot().capability).toBe('unavailable');
    f.port.replacePolicy({ ...policy, generation: 2 }); f.send({ ready: true });
    vi.advanceTimersByTime(1000); f.available(2); expect(f.port.getSnapshot().capability).toBe('available');
    f.port.dispose(); f.port.dispose(); f.port.replacePolicy({ ...policy, generation: 3 });
    expect(f.spawn).toHaveBeenCalledTimes(2); expect(f.port.getSnapshot().capability).toBe('unavailable');
  });
  it.each([2501, -1])('clears stale/negative-age data without refreshing cache time (%i)', age => {
    const f = fixture(); f.port.replacePolicy(policy); f.send({ ready: true }); f.available();
    vi.setSystemTime(1000 + age); expect(f.port.getSnapshot()).toMatchObject({ capability: 'unavailable', reason: 'stale' });
    expect(f.port.getSnapshot()).not.toHaveProperty('windowTitle'); f.port.dispose();
  });
  it('changes source eligibility after a >1500ms successful sample gap', () => {
    const f = fixture(); f.port.replacePolicy(policy); f.send({ ready: true }); f.available();
    const first = f.port.getSnapshot(); vi.setSystemTime(1601); vi.advanceTimersByTime(1000); f.available(2);
    const second = f.port.getSnapshot(); expect(second.capability).toBe('available');
    if (first.capability === 'available' && second.capability === 'available') {
      expect(second.sourceToken).not.toBe(first.sourceToken); expect(second.episodeToken).toBe(first.episodeToken);
    }
    f.port.dispose();
  });
  it('clears metadata on unavailable and policy replacement; stops pending reads', () => {
    const f = fixture(); f.port.replacePolicy(policy); f.send({ ready: true }); f.available();
    vi.advanceTimersByTime(1000); f.send({ id: 2, available: false, reason: 'excluded' });
    expect(f.port.getSnapshot()).toMatchObject({ reason: 'excluded' }); expect(f.port.getSnapshot()).not.toHaveProperty('appName');
    f.port.replacePolicy({ ...policy, generation: 2, active: false }); expect(f.children[0]!.kill).toHaveBeenCalledOnce(); f.port.dispose();
  });
  it.each([
    { id: 2, available: false, reason: 'excluded' }, { id: 1, available: false, reason: 'excluded', pid: 100 },
    { id: 1, available: true, appKey: 'key', episodeToken: 'e', sourceToken: 's', appName: 'editor', windowTitle: '\u202eevil' },
  ])('rejects malformed/private/stale messages', message => {
    const f = fixture(); f.port.replacePolicy(policy); f.send({ ready: true }); f.send(message);
    expect(f.port.getSnapshot()).toMatchObject({ reason: 'bridge_failed' }); f.port.dispose();
  });
  it('rejects oversized responses, invalid UTF8 and multiple envelopes', () => {
    for (const payload of [Buffer.alloc(4097, 32), Buffer.from([0xff, 10]), Buffer.from('{}\n{}\n')]) {
      const f = fixture(); f.port.replacePolicy(policy); f.send({ ready: true }); f.children[0]!.stdout.write(payload);
      expect(f.port.getSnapshot()).toMatchObject({ reason: 'bridge_failed' }); f.port.dispose();
    }
  });
  it('keeps existing session on invalid policy and handles synchronous invalidation subscribers', () => {
    const f = fixture(); f.port.replacePolicy(policy);
    expect(() => f.port.replacePolicy({ ...policy, applications: Array.from({ length: 33 }, () => application) })).toThrow();
    expect(f.children[0]!.kill).not.toHaveBeenCalled();
    f.port.subscribe(snapshot => { if (snapshot.capability === 'available') f.port.pause(); });
    f.send({ ready: true }); f.available(); expect(f.port.getSnapshot()).toMatchObject({ reason: 'paused' });
    vi.advanceTimersByTime(5000); expect(f.children[0]!.writes).toHaveLength(1); f.port.dispose();
  });
});
