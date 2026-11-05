import { describe, expect, it, vi } from 'vitest';
import { selectLocalActivity } from '../../src/domain/behavior/local-activity-policy';
import { AutonomyCharacterEngine } from '../../src/domain/character/autonomy-character-engine';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { createCharacterAutonomySnapshot } from '../../src/domain/character/autonomy-character-engine';

const snapshot = { needs: { energy: 51, comfort: 0, boredom: 24, play: 0, attention: 80 },
  synthesizedTone: 'neutral' as const, relationship: { friendship: 100 } };
const context = { nowMs: 0, canExplore: true, canPlay: false, canRest: true, history: [] };

describe('CE-I05 bounded Utility pool', () => {
  it('excludes a weak optional Rest at every draw while close choices vary', () => {
    const choices = Array.from({ length: 100 }, (_, i) => selectLocalActivity(snapshot, context, i / 100));
    expect(new Set(choices.map(value => value.intent.kind))).toEqual(new Set(['idle', 'wander']));
    expect(choices[0]!.trace.find(row => row.kind === 'sleep')).toMatchObject({ eligible: true, poolEligible: false, selected: false });
    expect(choices[0]!.trace.find(row => row.kind === 'sleep')!.score).toBeLessThan(.5);
    expect(choices.every(value => value.trace.filter(row => row.selected).length === 1)).toBe(true);
  });
  it('includes exact half-max ties, excludes the next lower value, and keeps stable right boundaries', () => {
    const tied = { ...snapshot, needs: { ...snapshot.needs, boredom: 9 } };
    const allowed = selectLocalActivity(tied, context, .99);
    expect(allowed.trace.find(row => row.kind === 'wander')).toMatchObject({ score: .5, poolEligible: true });
    expect(allowed.intent.kind).toBe('wander');
    const lower = selectLocalActivity({ ...tied, needs: { ...tied.needs, boredom: 8.999 } }, context, .99);
    expect(lower.trace.find(row => row.kind === 'wander')?.poolEligible).toBe(false);
    expect(lower.intent.kind).toBe('idle');
    expect(selectLocalActivity(snapshot, { ...context, canRest: false }, .5).intent.kind).toBe('idle');
    expect(selectLocalActivity(snapshot, { ...context, canRest: false }, .5 + Number.EPSILON).intent.kind).toBe('wander');
  });
  it('repeats both outcome and trace for the same complete inputs and only uses eligible positive scores', () => {
    const input = { ...context, history: [{ kind: 'idle', atMs: 0 }, { kind: 'calm:look_around', atMs: 0 }] };
    expect(selectLocalActivity(snapshot, input, .4)).toEqual(selectLocalActivity(snapshot, input, .4));
    const blocked = selectLocalActivity({ ...snapshot, causalEmotion: { kind: 'irritated', intensity: .6 } },
      { ...context, quiet: true, canSocial: true, canPlay: true, canExplore: false, canRest: false }, .999);
    expect(blocked.intent.kind).toBe('idle');
    expect(blocked.trace.filter(row => ['play', 'social_bid'].includes(row.kind)).every(row => row.score === 0 && !row.poolEligible)).toBe(true);
  });
  it('keeps a sole option, safely falls back for invalid required weights, and never exposes non-finite trace numbers', () => {
    const sole = { ...context, canExplore: false, canRest: false };
    expect(selectLocalActivity(snapshot, sole, .999).intent.kind).toBe('idle');
    for (const energy of [NaN, Infinity, -1, 101]) {
      const result = selectLocalActivity({ ...snapshot, needs: { ...snapshot.needs, energy } }, sole, .5);
      expect(result.intent.kind).toBe('idle');
      expect(result.trace.every(row => row.score === 0 && !row.poolEligible)).toBe(true);
      expect(result.trace.find(row => row.kind === 'idle')).toMatchObject({ eligible: false, reason: 'invalid_required_baseline' });
      expect(JSON.stringify(result.trace)).not.toContain('null');
    }
  });
  it('neutralizes unavailable optional affect and keeps irritation limited to SocialBid', () => {
    const social = { ...context, canSocial: true, canPlay: true };
    const baseline = selectLocalActivity(snapshot, social, .5);
    for (const causalEmotion of [undefined, null, { kind: 'irritated' as const, intensity: NaN },
      { kind: 'irritated' as const, intensity: -1 }, { kind: 'irritated' as const, intensity: 1.1 },
      { kind: 'content' as const, intensity: .6 }]) {
      expect(selectLocalActivity({ ...snapshot, causalEmotion }, social, .5)).toEqual(baseline);
    }
    const irritated = selectLocalActivity({ ...snapshot, causalEmotion: { kind: 'irritated', intensity: 1 } }, social, .5);
    for (const row of irritated.trace) {
      expect(row.emotionMultiplier).toBe(row.kind === 'social_bid' ? .8 : 1);
      expect(row.score).toBeCloseTo(baseline.trace.find(candidate => candidate.kind === row.kind)!.score * row.emotionMultiplier);
    }
  });
  it('different verified histories change social choice with identical Needs, relationships, time and draw', () => {
    const untouched = new CharacterStateService({ now: () => 0 }), interrupted = new CharacterStateService({ now: () => 0 });
    interrupted.observeCausalEpisode({ sequence: 1, source: 'user', triggerSequence: 1, activityRunId: 'game', activity: 'cursor_game',
      outcome: 'cancelled', cause: 'user_interrupted', executedMs: 1_500, participation: 'user_engaged' }, 0);
    const project = (character: CharacterStateService) => ({ ...createCharacterAutonomySnapshot(character.getState(),
      character.getCursorGameSatiation(), character.getCausalEmotion()), ...snapshot,
      localTraits: { openness: .5, playfulness: .5, independence: .5, extraversion: .5 } });
    expect(interrupted.getState()).toEqual(untouched.getState());
    const control = selectLocalActivity(project(untouched), { ...context, canExplore: false, canRest: false, canSocial: true }, .347);
    const changed = selectLocalActivity(project(interrupted), { ...context, canExplore: false, canRest: false, canSocial: true }, .347);
    // Fixed neutral local traits make the existing friendship baseline identical.
    expect(control.trace.find(row => row.kind === 'social_bid')?.baselineScore)
      .toBe(changed.trace.find(row => row.kind === 'social_bid')?.baselineScore);
    expect(control.trace.find(row => row.kind === 'social_bid')?.emotionMultiplier).toBe(1);
    expect(changed.trace.find(row => row.kind === 'social_bid')?.emotionMultiplier).toBe(.96);
    expect(control.intent.kind).not.toBe(changed.intent.kind);
  });
  it('uses one explicit draw for family and calm pose, with vital sleep outside the pool', () => {
    const engine = new AutonomyCharacterEngine(), next = vi.fn(() => .5);
    const input = { snapshot, selection: context, prng: { next }, candidates: [{ kind: 'sleep' as const, source: 'timer' as const, priority: 'high' as const }],
      context: { decisionSequence: 1, opportunityAtMs: 0, tone: 'neutral' as const, idleElapsedMs: 0 } };
    const result = engine.resolveAutonomousOpportunity(input);
    expect(result.resolvedIntent?.kind).toBe('idle'); expect(next).toHaveBeenCalledOnce();
    const critical = engine.resolveAutonomousOpportunity({ ...input, snapshot: { ...snapshot, needs: { ...snapshot.needs, energy: 20 } } });
    expect(critical.resolvedIntent?.reason).toBe('vital_sleep'); expect(next).toHaveBeenCalledOnce();
  });
});
