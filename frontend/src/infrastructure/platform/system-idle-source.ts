import { powerMonitor } from 'electron';
import type { SupportedPlatform } from '../../application/ports/platform-adapter.interface';
import type { SystemIdleLifecycleEvent, SystemIdlePort, SystemIdleReading } from '../../application/ports/system-idle.port';

/** Scalar-only capability, constructed by Main after Electron app readiness. */
export function createSystemIdleSource(platform: SupportedPlatform, displaySession?: string): SystemIdlePort {
  const events: NodeJS.EventEmitter = powerMonitor;
  const supported = platform !== 'linux' || displaySession === 'x11';
  const listeners = new Set<(event: SystemIdleLifecycleEvent) => void>();
  const cleanup: (() => void)[] = [];
  let disposed = false, suspended = false, inactiveSession = false;
  const emit = (event: SystemIdleLifecycleEvent) => {
    if (disposed) return;
    if (event === 'suspend' || event === 'resume') suspended = event === 'suspend';
    if (event === 'session_deactivated' || event === 'session_activated') inactiveSession = event === 'session_deactivated';
    for (const listener of [...listeners]) listener(event);
  };
  const bind = (native: 'suspend' | 'resume' | 'lock-screen' | 'unlock-screen' | 'user-did-resign-active' | 'user-did-become-active', event: SystemIdleLifecycleEvent) => {
    const handler = () => emit(event);
    events.on(native, handler);
    cleanup.push(() => events.removeListener(native, handler));
  };
  if (supported) {
    bind('suspend', 'suspend'); bind('resume', 'resume');
    if (platform !== 'linux') { bind('lock-screen', 'lock'); bind('unlock-screen', 'unlock'); }
    if (platform === 'darwin') {
      bind('user-did-resign-active', 'session_deactivated'); bind('user-did-become-active', 'session_activated');
    }
  }
  return {
    read(): SystemIdleReading {
      if (disposed) return { status: 'unavailable', reason: 'disposed' };
      if (!supported) return { status: 'unavailable', reason: 'unsupported' };
      if (suspended || inactiveSession) return { status: 'unavailable', reason: 'inactive_session' };
      try {
        const state = powerMonitor.getSystemIdleState(60);
        if (state === 'locked') return { status: 'unavailable', reason: 'inactive_session' };
        if (state !== 'active' && state !== 'idle') return { status: 'unavailable', reason: 'read_failed' };
        const seconds = powerMonitor.getSystemIdleTime(), idleMs = seconds * 1000;
        if (seconds === 0) return { status: 'unavailable', reason: 'unconfirmed' };
        return Number.isSafeInteger(seconds) && seconds > 0 && Number.isSafeInteger(idleMs)
          ? { status: 'available', idleMs } : { status: 'unavailable', reason: 'read_failed' };
      } catch { return { status: 'unavailable', reason: 'read_failed' }; }
    },
    subscribeLifecycle(listener) {
      if (!disposed) listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      if (disposed) return;
      disposed = true; listeners.clear(); for (const release of cleanup) release(); cleanup.length = 0;
    },
  };
}
