import { expect, it } from 'vitest';
import { createOwnInterestGate, effectiveOwnGameMultiplier, isOwnGameSource, learnOwnGameInterest, reflectOwnGameInterest, type OwnGameEpisode } from '../../src/domain/character/own-game-interest';
import type { CausalSourceReference, PreferenceTrack } from '../../src/domain/character/types';
const episode = (sequence: number): OwnGameEpisode => ({ appRunId: 'app', sequence, revision: 1, source: 'autonomy', terminalReason: null, triggerSequence: null, activity: 'cursor_game', activityRunId: `run${sequence}`, cause: 'completed', outcome: 'completed', participation: 'user_engaged', executedMs: 1000 });
it('learns only acknowledged eligible games at a separate bounded gate, never replaying a skipped event', () => {
  let gate = createOwnInterestGate(0); let track: PreferenceTrack | undefined; let refs: readonly CausalSourceReference[] = [];
  const apply = (sequence: number, at: number) => { const r = learnOwnGameInterest(track, refs, gate, episode(sequence), at); gate = r.gate; track = r.track; refs = r.sources; return r.accepted; };
  expect(apply(1, 0)).toBe(false); expect(apply(1, 300000)).toBe(false);
  for (let i = 2; i <= 25; i++) expect(apply(i, (i - 1) * 300000)).toBe(true);
  expect(track).toEqual({ value: 24, samples: 24, confidence: 24 / 30 }); expect(refs).toHaveLength(20);
  expect(apply(2, 99999999)).toBe(false); expect(track?.samples).toBe(24);
  const reflected = reflectOwnGameInterest(track, refs); expect(reflected.band).toBe('established'); expect(reflected.multiplier).toBeCloseTo(1.048);
});
it('does not learn from interruption, solitary, short, failed, malformed or another app run', () => {
  const gate = createOwnInterestGate(0), e = episode(1);
  for (const invalid of [{ ...e, outcome: 'failed' }, { ...e, cause: 'user_interrupted' }, { ...e, participation: 'solitary' }, { ...e, executedMs: 999 }, { ...e, executedMs: Infinity }]) {
    expect(isOwnGameSource(invalid)).toBe(false); expect(learnOwnGameInterest(undefined, [], gate, invalid, 300000).accepted).toBe(false);
  }
  const r = learnOwnGameInterest(undefined, [], gate, e, 300000);
  expect(learnOwnGameInterest(r.track, r.sources, r.gate, { ...e, appRunId: 'old', sequence: 100 }, 600000).accepted).toBe(false);
});
it('requires proof independent of a persisted numeric taste and keeps reflection source-linked', () => {
  const track = { value: 100, samples: 1000, confidence: 1000 / 1006 };
  const refs = Array.from({ length: 20 }, (_, i) => ({ appRunId: 'app', sequence: i + 1, revision: 1 as const }));
  expect(reflectOwnGameInterest(track, refs.slice(0, 5))).toEqual({ band: 'none', multiplier: 1, sources: [] });
  expect(reflectOwnGameInterest(track, refs.slice(0, 6)).band).toBe('emerging');
  expect(reflectOwnGameInterest(track, refs).multiplier).toBe(1.2);
  expect(reflectOwnGameInterest({ ...track, samples: 1 }, refs).multiplier).toBe(1);
});

it('preserves the old user mapping without proof and bounds the combined own/user coefficient', () => {
  for (const user of [undefined, { value: 100, confidence: 1 }, { value: -100, confidence: 1 }, { value: 50, confidence: .6 }]) {
    expect(effectiveOwnGameMultiplier(user, undefined)).toBe(1);
    expect(effectiveOwnGameMultiplier(user, 1)).toBe(1);
    const u = user && user.confidence >= .5 ? 1 + .2 * user.value / 100 * user.confidence : 1;
    expect(u * effectiveOwnGameMultiplier(user, 1.2)).toBeLessThanOrEqual(1.2);
  }
  expect(effectiveOwnGameMultiplier({ value: 100, confidence: 1 }, 1.2)).toBe(1);
  expect(effectiveOwnGameMultiplier(undefined, Infinity)).toBe(1);
});
