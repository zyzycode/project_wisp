import { expect, it } from 'vitest';
import { LOCAL_TUNING_VERSION, selectLocalActivity } from '../../src/domain/behavior/local-activity-policy';
import { createCharacterAutonomySnapshot, AutonomyCharacterEngine } from '../../src/domain/character/autonomy-character-engine';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { vi } from 'vitest';

const snapshot = { needs: { energy: 51, comfort: 0, boredom: 24, play: 0, attention: 80 },
  synthesizedTone: 'neutral' as const, relationship: { friendship: 100 } };
const context = { nowMs: 0, canExplore: false, canPlay: false, canRest: false, history: [] };
it.each([
  ['explore', 'learnedExplorePreference', 'wander', .5],
  ['social', 'learnedSocialBidPreference', 'play', 25 / 73],
] as const)('separates six positive/negative %s samples with the same draw', (family, projection, expected, draw) => {
  const selection = { ...context, canExplore: family === 'explore', canSocial: family === 'social' };
  const liked = selectLocalActivity({ ...snapshot, [projection]: { value: 12, confidence: .5 } }, selection, draw);
  const disliked = selectLocalActivity({ ...snapshot, [projection]: { value: -12, confidence: .5 } }, selection, draw);
  expect(liked.intent.kind).toBe(expected); expect(disliked.intent.kind).toBe('idle');
  const target = family === 'explore' ? 'wander' : 'social_bid';
  const weight = family === 'explore' ? 1 : 1.92;
  expect(liked.trace.find(row => row.kind === target)).toMatchObject({ baselineScore: weight, preferenceMultiplier: 1.012 });
  expect(liked.trace.find(row => row.kind === target)?.score).toBeCloseTo(weight * 1.012);
  expect(disliked.trace.find(row => row.kind === target)?.preferenceMultiplier).toBe(.988);
});
it.each([undefined, { value: 2, confidence: 1 / 7 }, { value: 10, confidence: 5 / 11 }, { value: NaN, confidence: 1 },
  { value: Infinity, confidence: 1 }, { value: 101, confidence: 1 }, { value: -101, confidence: 1 },
  { value: 100, confidence: NaN }, { value: 100, confidence: Infinity }, { value: 100, confidence: 1.1 },
  { value: 100, confidence: -.1 },
])('keeps invalid or insufficient evidence neutral: %j', preference => {
  const result = selectLocalActivity({ ...snapshot, learnedExplorePreference: preference, learnedSocialBidPreference: preference },
    { ...context, canExplore: true, canSocial: true }, .5);
  expect(result.trace.every(row => row.preferenceMultiplier === 1)).toBe(true);
});
it.each([-100, 100])('bounds %s weights and never revives disabled families or quiet social bids', value => {
  const preference = { value, confidence: 1 };
  const input = { ...snapshot, learnedExplorePreference: preference, learnedSocialBidPreference: preference,
    learnedCursorGamePreference: { value: 100, confidence: 1 } };
  const allowed = selectLocalActivity(input, { ...context, canExplore: true, canSocial: true }, .5);
  expect(allowed.trace.map(row => row.kind)).toEqual(['idle', 'wander', 'sleep', 'play', 'social_bid']);
  for (const row of allowed.trace) expect(row.preferenceMultiplier).toBe(['wander', 'social_bid'].includes(row.kind) ? 1 + value / 500 : 1);
  const blocked = selectLocalActivity(input, { ...context, canSocial: true, quiet: true }, .99);
  expect(blocked.intent.kind).toBe('idle');
  expect(blocked.trace.filter(row => row.kind !== 'idle').every(row => row.score === 0)).toBe(true);
  expect(LOCAL_TUNING_VERSION).toBe('CHAR-I03-v1');
});
it('projects only validated bounded local tracks and preserves authored axes/needs', () => {
  const state = new CharacterStateService({ now: () => 0 }).getState();
  state.preferences = { 'activity.explore': { value: 12, confidence: .5, samples: 6 },
    'activity.social_bid': { value: NaN, confidence: 1, samples: 6 }, unknown: { value: 100, confidence: 1, samples: 6 } };
  const result = createCharacterAutonomySnapshot(state);
  expect(result.learnedExplorePreference).toEqual({ value: 12, confidence: .5 });
  expect(result.learnedSocialBidPreference).toBeUndefined();
  expect(result.needs).toEqual(state.needs);
  expect(result.localTraits?.openness).toBe(state.personality.axes.openness.current);
  expect(result).not.toHaveProperty('preferences');
});
it('uses one existing RNG draw for local preference selection and preserves critical sleep priority', () => {
  const next = vi.fn(() => .5), engine = new AutonomyCharacterEngine();
  const input = { context: { decisionSequence: 1, opportunityAtMs: 0, tone: 'neutral' as const, idleElapsedMs: 0 },
    snapshot: { ...snapshot, learnedExplorePreference: { value: 100, confidence: 1 } },
    candidates: [{ kind: 'sleep' as const, source: 'timer' as const, priority: 'normal' as const }],
    selection: { ...context, canExplore: true }, prng: { next } };
  expect(engine.resolveAutonomousOpportunity(input).resolvedIntent?.kind).toBe('wander'); expect(next).toHaveBeenCalledOnce();
  const critical = engine.resolveAutonomousOpportunity({ ...input, snapshot: { ...input.snapshot, needs: { ...snapshot.needs, energy: 20 } } });
  expect(critical.resolvedIntent?.reason).toBe('vital_sleep'); expect(next).toHaveBeenCalledOnce();
});
