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

it('starts a deferred offer at a safe boundary once, and reset cancels ownership', () => {
  let now = 100; let safe = false; const cancel = vi.fn();
  const start = vi.fn(() => ({ runId: 'run', startedAtMs: now }));
  const admission = new ProviderBehaviorAdmission({ now: () => now, gate: () => null, safeToStart: () => safe, canDefer: () => true, start, cancel });
  const context = { requestId: 'request', conversationId: 'conversation', generation: 1, requestedAtMs: 0 };
  admission.setContext(context); admission.offer(offer); now = 1000; safe = true; admission.tick(); admission.tick();
  expect(start).toHaveBeenCalledTimes(1); expect(admission.getOwnedRun()?.ownership.source).toBe('provider');
  admission.setContext(null); expect(cancel).toHaveBeenCalledTimes(1);
  expect(admission.offer(offer)).toEqual({ status: 'rejected', reason: 'stale_generation' });
});
it('rejects expired, malformed and obsolete offers without cancelling a local run', () => {
  const start = vi.fn(() => null); const cancel = vi.fn(); let now = 100;
  const admission = new ProviderBehaviorAdmission({ now: () => now, gate: () => null, safeToStart: () => true, canDefer: () => false, start, cancel });
  admission.setContext({ requestId: 'request', conversationId: 'conversation', generation: 1, requestedAtMs: 0 });
  expect(admission.offer({ ...offer, receivedAtMs: Number.NaN })).toEqual({ status: 'rejected', reason: 'invalid_offer' });
  expect(admission.offer({ ...offer, generation: 0 })).toEqual({ status: 'rejected', reason: 'stale_generation' });
  now = 30000; expect(admission.offer(offer)).toEqual({ status: 'rejected', reason: 'expired' });
  expect(start).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
});
