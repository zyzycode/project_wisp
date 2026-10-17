import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ canonical: vi.fn((value: string) => value), spawn: vi.fn(), temp: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs', () => ({ default: { realpathSync: { native: mocks.canonical }, statSync: () => ({ isFile: () => true }), mkdtempSync: mocks.temp } }));
vi.mock('electron', async () => {
  const { EventEmitter: Events } = await import('node:events');
  return { app: { getAppMetrics: () => [], getPath: vi.fn() }, powerMonitor: new Events() };
});
import { powerMonitor } from 'electron';
import { createActiveApplicationObservation } from '../../src/infrastructure/platform/active-application-factory';
afterEach(() => vi.clearAllMocks());
describe('observation composition', () => {
  it('binds lock/suspend pauses, clears metadata and releases all listeners on dispose', () => {
    const baselineLock = powerMonitor.listenerCount('lock-screen');
    const baselineSuspend = powerMonitor.listenerCount('suspend');
    const factory = createActiveApplicationObservation();
    const listener = vi.fn(); factory.port.subscribe(listener);
    expect(powerMonitor.listenerCount('lock-screen')).toBe(baselineLock + 1);
    (powerMonitor as EventEmitter).emit('lock-screen');
    expect(factory.port.getSnapshot()).toMatchObject({ capability: 'unavailable', reason: 'paused' });
    (powerMonitor as EventEmitter).emit('suspend'); expect(listener).toHaveBeenCalledTimes(2);
    factory.port.dispose(); factory.port.dispose();
    expect(powerMonitor.listenerCount('lock-screen')).toBe(baselineLock);
    expect(powerMonitor.listenerCount('suspend')).toBe(baselineSuspend);
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(mocks.temp).not.toHaveBeenCalled();
    expect(() => factory.registerExecutable('C:\\Tools\\Editor.exe')).toThrow();
  });
  it('registers canonical files without helper startup and forget/delete invalidate existing policies', () => {
    const factory = createActiveApplicationObservation();
    const app = factory.registerExecutable('C:\\Tools\\Editor.exe');
    expect(app).not.toHaveProperty('path');
    factory.port.replacePolicy({ generation: 1, active: false, applications: [app] });
    factory.forgetExecutable(app.appKey);
    expect(factory.port.getSnapshot()).toMatchObject({ reason: 'paused' });
    expect(() => factory.port.replacePolicy({ generation: 2, active: false, applications: [app] })).toThrow();
    const next = factory.registerExecutable('C:\\Tools\\Editor.exe'); expect(next.appKey).not.toBe(app.appKey);
    factory.clearExecutables();
    expect(() => factory.port.replacePolicy({ generation: 2, active: false, applications: [next] })).toThrow();
    expect(mocks.spawn).not.toHaveBeenCalled(); factory.port.dispose();
  });
});
