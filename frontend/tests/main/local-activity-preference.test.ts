import { expect, it } from 'vitest';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { createCharacterAutonomySnapshot } from '../../src/domain/character/autonomy-character-engine';
import { selectLocalActivity } from '../../src/domain/behavior/local-activity-policy';
import { scenario } from './autonomy-scenario-fixture';

function state() {
  const seed = new CharacterStateService({ now: () => 0 }).getState();
  return { ...seed, needs: { energy: 51, comfort: 0, attention: 80, play: 0, boredom: 24 },
    relationship: { ...seed.relationship, friendship: 100 } };
}
it.each(['activity.explore', 'activity.social_bid'] as const)('uses real authored traits and %s projection in Main, preserving other weights', key => {
  const original = state(), family = key === 'activity.explore' ? 'wander' : 'social_bid';
  const baseline = selectLocalActivity(createCharacterAutonomySnapshot(original), {
    nowMs: 0, canExplore: true, canSocial: true, canPlay: false, canRest: true, history: [],
  }, 0).trace;
  const prior = baseline.slice(0, baseline.findIndex(row => row.kind === family)).reduce((sum, row) => sum + row.score, 0);
  const draw = prior / baseline.reduce((sum, row) => sum + row.score, 0);
  const choices = [12, -12].map(value => {
    const f = scenario({}, draw, { ...original, preferences: { [key]: { value, confidence: .5, samples: 6 } } }, undefined, {}, true);
    try {
      f.pulse();
      const selected = f.main.getDecisionTrace().at(-1)!;
      expect(selected.tuningVersion).toBe('CHAR-I03-v1');
      const target = selected.selection?.find(row => row.kind === family);
      expect(target?.preferenceMultiplier).toBe(value === 12 ? 1.012 : .988);
      for (const row of selected.selection ?? []) {
        expect(row.baselineScore).toBeCloseTo(baseline.find(item => item.kind === row.kind)!.score);
        if (row.kind !== family) expect(row.preferenceMultiplier).toBe(1);
      }
      expect(f.character.getState().personality).toEqual(original.personality);
      expect(f.character.getState().relationship).toEqual(original.relationship);
      expect(f.character.getState().intimacy).toEqual(original.intimacy);
      return f.main.getActivityTimeline()?.activityId;
    } finally { f.main.dispose(); }
  });
  expect(choices[0]).toBe(key === 'activity.explore' ? 'explore' : 'social_bid');
  expect(choices[1]).not.toBe(choices[0]);
});
it('high social preference cannot spend a third initiative token or interrupt its active peer', () => {
  const initial = state();
  const f = scenario({}, .999, { ...initial, needs: { ...initial.needs, attention: 100 },
    preferences: { 'activity.social_bid': { value: 100, confidence: 1, samples: 1000 } } });
  try {
    f.pulse(); expect(f.main.getActivityTimeline()?.activityId).toBe('social_bid');
    const first = f.main.getActivityTimeline()?.runId; f.advance(1);
    expect(f.main.getActivityTimeline()?.runId).toBe(first);
    f.finish(); f.advance(31000);
    // A newly accepted contact releases SOC-A01's session silence latch.
    f.main.acceptUserContact(); f.pulse();
    expect(f.main.getActivityTimeline()?.activityId).toBe('social_bid');
    f.finish(); f.advance(31000); f.pulse();
    expect(f.main.getActivityTimeline()?.activityId).not.toBe('social_bid');
    expect(f.main.getDecisionTrace().at(-1)?.selection?.find(row => row.kind === 'social_bid')?.score).toBe(0);
  } finally { f.main.dispose(); }
});
