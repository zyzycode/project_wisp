import { expect, it, vi } from 'vitest';
const events = await vi.hoisted(async () => ({ monitor: new (await import('node:events')).EventEmitter() }));
vi.mock('electron', () => ({ powerMonitor: events.monitor }));
import { subscribeVoiceRevocation } from '../../src/infrastructure/platform/voice-lifecycle';
it('revokes on system boundaries, never resumes automatically, and unsubscribes', () => {
  const revoke = vi.fn();
  const release = subscribeVoiceRevocation(revoke);
  for (const event of ['suspend', 'lock-screen', 'user-did-resign-active']) events.monitor.emit(event);
  expect(revoke).toHaveBeenCalledTimes(3);
  for (const event of ['resume', 'unlock-screen', 'user-did-become-active']) events.monitor.emit(event);
  expect(revoke).toHaveBeenCalledTimes(3);
  release(); events.monitor.emit('suspend');
  expect(revoke).toHaveBeenCalledTimes(3);
});
