import { expect, it, vi } from 'vitest';
import { InitiativeSessionControls, type InitiativeSessionConditions } from '../../src/application/services/initiative-session-controls';

it('starts disabled; credential capability and reads never dispatch or grant consent', async () => {
  const revoke = vi.fn(), changed = vi.fn();
  const controls = new InitiativeSessionControls({ streamId: () => 's', conditions: () => ({
    capability: true, memory: true, quiet: false, sleeping: false, away: false, busy: false,
  }), revoke, changed });
  expect(await controls.read({ streamId: 's' })).toMatchObject({ ok: true, status: {
    enabled: false, blockReason: 'disabled', requestsSent: 0, phase: 'off', profileGeneration: 0,
  } });
  expect(await controls.setConsent({ streamId: 's', profileGeneration: 0, enabled: true })).toMatchObject({ ok: true });
  expect(controls.allowed()).toBe(true);
  expect(controls.status().requestsSent).toBe(0);
  controls.dispatched(); controls.failed('timeout');
  await controls.setConsent({ streamId: 's', profileGeneration: 0, enabled: false });
  expect(revoke).toHaveBeenCalledOnce();
  expect(controls.status()).toMatchObject({ requestsSent: 1, lastFailure: 'timeout', enabled: false });
});

it('revokes before reset storage acknowledgement and rejects delayed consent in unchanged stream', async () => {
  let resolve!: () => void;
  const sqlAcknowledgement = new Promise<void>(yes => { resolve = yes; });
  const controls = new InitiativeSessionControls({ streamId: () => 'same', revoke: vi.fn(), conditions: () => ({
    capability: true, memory: true, quiet: false, sleeping: false, away: false, busy: false,
  }) });
  await controls.setConsent({ streamId: 'same', profileGeneration: 0, enabled: true });
  const delayedOldCommand = { streamId: 'same', profileGeneration: 0, enabled: true };
  controls.resetProfile();
  const resetPending = sqlAcknowledgement.then(() => controls.status());
  expect(controls.status()).toMatchObject({ enabled: false, profileGeneration: 1 });
  expect(await controls.setConsent(delayedOldCommand)).toEqual({ ok: false, code: 'stale' });
  resolve(); expect(await resetPending).toMatchObject({ enabled: false, profileGeneration: 1 });
});

it('reports fixed block priority and still allows revocation when capability disappears', async () => {
  let conditions: InitiativeSessionConditions = { capability: true, memory: true, quiet: false,
    sleeping: false, away: false, busy: false };
  const controls = new InitiativeSessionControls({ streamId: () => 's', conditions: () => conditions, revoke: vi.fn() });
  await controls.setConsent({ streamId: 's', profileGeneration: 0, enabled: true });
  conditions = { capability: false, memory: false, quiet: true, sleeping: true, away: true, busy: true };
  expect(controls.status().blockReason).toBe('quiet');
  conditions = { ...conditions, quiet: false }; expect(controls.status().blockReason).toBe('sleeping');
  conditions = { ...conditions, sleeping: false }; expect(controls.status().blockReason).toBe('away');
  conditions = { ...conditions, away: false }; expect(controls.status().blockReason).toBe('provider_unavailable');
  expect(await controls.setConsent({ streamId: 's', profileGeneration: 0, enabled: false })).toMatchObject({ ok: true });
  expect(await controls.setConsent({ streamId: 's', profileGeneration: 0, enabled: true })).toEqual({ ok: false, code: 'unavailable' });
});
it('does not replay a natural source from before the latest explicit enable and blocks enable without memory', async () => {
  let now = 100, memory = false;
  const controls = new InitiativeSessionControls({ now: () => now, streamId: () => 's', revoke: vi.fn(),
    conditions: () => ({ capability: true, memory, quiet: false, sleeping: false, away: false, busy: false }) });
  expect(controls.status().capability).toBe('unavailable');
  expect(await controls.setConsent({ streamId: 's', profileGeneration: 0, enabled: true })).toEqual({ ok: false, code: 'unavailable' });
  memory = true;
  await controls.setConsent({ streamId: 's', profileGeneration: 0, enabled: true });
  expect(controls.sourceAllowed(99)).toBe(false); expect(controls.sourceAllowed(100)).toBe(true);
  await controls.setConsent({ streamId: 's', profileGeneration: 0, enabled: false });
  now = 200; await controls.setConsent({ streamId: 's', profileGeneration: 0, enabled: true });
  expect(controls.sourceAllowed(150)).toBe(false); expect(controls.getPolicyGeneration()).toBe(3);
});
