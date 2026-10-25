import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createSystemIdleSource } from '../../src/infrastructure/platform/system-idle-source';

const native = vi.hoisted(() => ({ seconds: vi.fn(() => 3), state: vi.fn(() => 'active') }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return { powerMonitor: Object.assign(new EventEmitter(), { getSystemIdleTime: native.seconds, getSystemIdleState: native.state }) };
});
import { powerMonitor } from 'electron';
const monitor: EventEmitter = powerMonitor;
beforeEach(() => { monitor.removeAllListeners(); vi.clearAllMocks(); native.seconds.mockReturnValue(3); native.state.mockReturnValue('active'); });

describe('system idle scalar capability', () => {
  it.each(['win32', 'darwin', 'linux'] as const)('normalizes whole seconds to milliseconds on %s', platform => {
    const source = createSystemIdleSource(platform, 'x11');
    expect(source.read()).toEqual({ status: 'available', idleMs: 3000 });
    expect(native.state).toHaveBeenCalledWith(60); source.dispose();
  });
  it.each(['wayland', '', 'unknown'])('does not call idle APIs for unconfirmed Linux session %s', session => {
    const source = createSystemIdleSource('linux', session);
    expect(source.read()).toEqual({ status: 'unavailable', reason: 'unsupported' });
    expect(native.state).not.toHaveBeenCalled(); expect(native.seconds).not.toHaveBeenCalled(); source.dispose();
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])('rejects ambiguous or invalid scalar %s', seconds => {
    native.seconds.mockReturnValue(seconds); const source = createSystemIdleSource('darwin');
    expect(source.read()).toEqual({ status: 'unavailable', reason: seconds === 0 ? 'unconfirmed' : 'read_failed' }); source.dispose();
  });
  it('contains failures and distinguishes locked from unknown', () => {
    const source = createSystemIdleSource('darwin'); native.state.mockReturnValue('locked');
    expect(source.read()).toEqual({ status: 'unavailable', reason: 'inactive_session' });
    native.state.mockReturnValue('unknown'); expect(source.read()).toEqual({ status: 'unavailable', reason: 'read_failed' });
    native.state.mockImplementationOnce(() => { throw new Error('native internals'); });
    expect(source.read()).toEqual({ status: 'unavailable', reason: 'read_failed' }); source.dispose();
  });
  it('stops reads while suspended or session inactive, recovers and removes all listeners', () => {
    const source = createSystemIdleSource('darwin'), listener = vi.fn();
    const unsubscribe = source.subscribeLifecycle(listener);
    monitor.emit('suspend'); expect(source.read()).toEqual({ status: 'unavailable', reason: 'inactive_session' });
    expect(native.seconds).not.toHaveBeenCalled(); monitor.emit('resume');
    expect(source.read()).toEqual({ status: 'available', idleMs: 3000 });
    monitor.emit('user-did-resign-active'); expect(source.read().status).toBe('unavailable');
    monitor.emit('user-did-become-active'); monitor.emit('lock-screen'); monitor.emit('unlock-screen');
    expect(listener.mock.calls.map(([event]) => event)).toEqual(['suspend', 'resume', 'session_deactivated', 'session_activated', 'lock', 'unlock']);
    unsubscribe(); unsubscribe(); source.dispose(); source.dispose();
    monitor.emit('suspend'); expect(listener).toHaveBeenCalledTimes(6);
    expect(monitor.eventNames()).toEqual([]);
    expect(source.read()).toEqual({ status: 'unavailable', reason: 'disposed' });
  });
});
