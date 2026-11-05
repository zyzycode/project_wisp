import { expect, it, vi } from 'vitest';
import { WindowHelpSession } from '../../src/application/services/window-help-session';
import type { VerifiedWindowHelpTarget, WindowHelpChoice } from '../../src/application/ports/window-help.interface';
const target = (capturedAtMs: number): VerifiedWindowHelpTarget => ({ surfaceId: 'opaque', sourceEpoch: 1,
  policyGeneration: 0, geometrySignature: 'geometry', capturedAtMs,
  preview: { region: 'upper_center', left: .2, top: .2, width: .6, height: .4 } });
const choice = (at = 0, sequence = 1): WindowHelpChoice => ({ decisionSequence: sequence,
  generation: 0, selectedAtMs: at, reason: 'resolved_explore_needs_manual_support', target: target(at) });
const eligibility = { allowed: true, noCausalOverride: true, boredom: 70, energy: 50 };
function fixture() {
  const cancelGeneration = vi.fn(), clearSpeech = vi.fn(), closed = vi.fn();
  return { session: new WindowHelpSession({ cancelGeneration, clearSpeech, closed }), closed, cancelGeneration, clearSpeech };
}
it('does not create waiting before publication and prevents old resolved choice replay', () => {
  const { session, closed } = fixture();
  expect(session.prepare(choice(), 'r', 0, eligibility)).toBe(true);
  expect(session.status(3499).phase).toBe('preparing');
  expect(session.status(3500)).toMatchObject({ phase: 'closed', outcome: 'cancelled' });
  expect(closed).toHaveBeenCalledOnce();
  expect(session.prepare(choice(3500), 'retry', 3500, eligibility)).toBe(false);
  expect(session.prepare(choice(3500, 2), 'new-decision-retry', 3500, eligibility)).toBe(false);
});
it('preserves published goal through accepted assist drag only and requires same fresh accepted attachment', () => {
  const { session } = fixture();
  session.prepare(choice(), 'r', 0, eligibility); session.dispatched('r', 100);
  expect(session.published('r', 500)).toBe(true);
  expect(session.beginAcceptedDrag(1000)).toBe(true);
  session.forcedOwner(1000, true);
  expect(session.status(1001)).toMatchObject({ phase: 'assisting', expiresAtMs: 11000 });
  session.acceptedRelease(target(2000), 2000);
  expect(session.status(2000)).toMatchObject({ phase: 'closed', outcome: 'fulfilled' });
});
it.each(['elsewhere', 'changed', 'stale'] as const)('does not fulfill accepted release %s', kind => {
  const { session } = fixture();
  session.prepare(choice(), 'r', 0, eligibility); session.dispatched('r', 0); session.published('r', 10);
  session.beginAcceptedDrag(20);
  session.acceptedRelease(kind === 'elsewhere' ? null : kind === 'changed'
    ? { ...target(1000), sourceEpoch: 2 } : target(0), 1000);
  expect(session.status(1000)).toMatchObject({ phase: 'closed', outcome: 'cancelled' });
});
it('aborts prepublication drag, bounds waiting and assisting, and never treats ignoring as decline', () => {
  const { session } = fixture();
  session.prepare(choice(), 'early', 0, eligibility);
  expect(session.beginAcceptedDrag(10)).toBe(false);
  session.observeBoredom(39, 20);
  session.prepare(choice(20, 2), 'waiting', 20, eligibility);
  session.dispatched('waiting', 20); session.published('waiting', 30);
  expect(session.status(60030)).toMatchObject({ phase: 'closed', outcome: 'unanswered' });
  expect(session.status(70030)).toEqual({ phase: 'none' });
});
it('requires causal-free eligibility, budgets one dispatch, and only boredom below40 rearms after20min', () => {
  const { session } = fixture();
  expect(session.prepare(choice(), 'blocked', 0, { ...eligibility, noCausalOverride: false })).toBe(false);
  session.prepare(choice(), 'r', 0, eligibility);
  expect(session.dispatched('r', 0)).toBe(true); expect(session.dispatched('r', 0)).toBe(false);
  session.cancel(20);
  expect(session.eligible(1200000, eligibility)).toBe(false);
  session.observeBoredom(39, 1200000);
  expect(session.eligible(1200000, eligibility)).toBe(true);
});
it('stable fresh polls preserve request, geometry/source changes close it without penalty', () => {
  const { session } = fixture();
  session.prepare(choice(), 'r', 0, eligibility);
  expect(session.refresh(target(200), 200)).toBe(true);
  expect(session.refresh({ ...target(300), geometrySignature: 'new' }, 300)).toBe(false);
  expect(session.status(300)).toMatchObject({ phase: 'closed', outcome: 'target_lost' });
});
