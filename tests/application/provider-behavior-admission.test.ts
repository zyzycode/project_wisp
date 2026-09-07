import { expect, it, vi } from 'vitest';
import { ProviderBehaviorAdmission } from '../../src/application/services/provider-behavior-admission';
import type { ProviderBehaviorOffer } from '../../src/application/ports/behavior-admission-port';
const offer: ProviderBehaviorOffer = { intent: { kind: 'idle', source: 'provider', priority: 'normal', requestId: 'request' },
  conversationId: 'conversation', generation: 1, requestedAtMs: 0, receivedAtMs: 100, expiresAtMs: 30000 };
it('starts once, expires ownership and rejects duplicate settlement', () => {
  let now = 100;
  const cancel = vi.fn(); const start = vi.fn(() => ({ runId: 'run', startedAtMs: now }));
  const admission = new ProviderBehaviorAdmission({ now: () => now, gate: () => null, safeToStart: () => true, canDefer: () => false, start, cancel });
  admission.setContext({ requestId: 'request', conversationId: 'conversation', generation: 1, requestedAtMs: 0 });
  expect(admission.offer(offer).status).toBe('admitted');
  expect(admission.offer(offer)).toEqual({ status: 'rejected', reason: 'duplicate' });
  now = 20100; admission.tick();
  expect(cancel).toHaveBeenCalledTimes(1); expect(start).toHaveBeenCalledTimes(1);
});
it('defers only until its bounded safe boundary and never starts at the deadline', () => {
  let now = 100; let safe = false;
  const start = vi.fn(() => ({ runId: 'run', startedAtMs: now }));
  const admission = new ProviderBehaviorAdmission({ now: () => now, gate: () => null, safeToStart: () => safe, canDefer: () => true, start, cancel: vi.fn() });
  admission.setContext({ requestId: 'request', conversationId: 'conversation', generation: 1, requestedAtMs: 0 });
  expect(admission.offer(offer)).toMatchObject({ status: 'admitted', mode: 'safe_deferred' });
  now = 3100; safe = true; admission.tick();
  expect(start).not.toHaveBeenCalled(); expect(admission.hasPending()).toBe(false);
});
