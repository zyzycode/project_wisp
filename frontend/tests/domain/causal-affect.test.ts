import { describe, expect, it } from 'vitest';
import { appraiseCausalEvent, createCausalAffectState, decayCausalAffect, type CausalObservedEvent } from '../../src/domain/character/causal-affect';

const contact: CausalObservedEvent = { sequence: 1, source: 'user', triggerSequence: null,
  activityRunId: null, activity: null, outcome: null, cause: 'contact', executedMs: 0, participation: 'none' };
const interrupted: CausalObservedEvent = { ...contact, activityRunId: 'game-1', activity: 'cursor_game',
  outcome: 'cancelled', cause: 'user_interrupted', executedMs: 1_000, triggerSequence: 1 };

describe('CE-A01 causal affect', () => {
  it('distinguishes accepted contact, completed participation and real interruption with the same time', () => {
    const calm = appraiseCausalEvent(createCausalAffectState(), contact, 0);
    expect(calm.emotion).toEqual({ causeSequence: 1, cause: 'contact', kind: 'curious', intensity: 0.1, target: 'self' });
    expect(appraiseCausalEvent(createCausalAffectState(), interrupted, 0).emotion)
      .toMatchObject({ causeSequence: 1, cause: 'user_interrupted', kind: 'irritated', intensity: 0.2, target: 'user' });
    expect(appraiseCausalEvent(createCausalAffectState(), { ...interrupted, cause: 'completed', outcome: 'completed', participation: 'user_engaged' }, 0).emotion)
      .toMatchObject({ kind: 'content', intensity: 0.2, target: 'user' });
  });

  it('only distinct verified interruptions within 60s strengthen bounded irritation', () => {
    let state = createCausalAffectState();
    for (let sequence = 1; sequence <= 10; sequence++) {
      state = appraiseCausalEvent(state, { ...interrupted, sequence, activityRunId: `game-${sequence}` }, sequence * 1_000);
      expect(state.emotion?.intensity).toBeCloseTo(Math.min(0.6, 0.2 + (sequence - 1) * 0.1));
      expect(state.interruptionTimes.length).toBeLessThanOrEqual(4);
    }
    expect(appraiseCausalEvent(state, { ...interrupted, sequence: 10 }, 11_000)).toBe(state);
    expect(appraiseCausalEvent(state, { ...interrupted, sequence: 9 }, 12_000)).toBe(state);
    expect(appraiseCausalEvent(state, { ...interrupted, sequence: 11 }, 70_000).emotion?.intensity).toBe(0.2);
  });

  it('environment failures remain environmental; unknown, other and unproven user causes have no appraisal', () => {
    for (const cause of ['environment_lost', 'timeout'] as const) {
      expect(appraiseCausalEvent(createCausalAffectState(), { ...interrupted, cause, source: 'system', triggerSequence: null }, 0).emotion)
        .toMatchObject({ kind: 'irritated', intensity: 0.1, target: 'environment' });
    }
    for (const event of [
      { ...interrupted, cause: 'unknown' as const }, { ...interrupted, cause: 'other' as const },
      { ...interrupted, source: 'unknown' as const }, { ...interrupted, triggerSequence: null },
      { ...interrupted, executedMs: 999 }, { ...interrupted, outcome: 'failed' as const },
      { ...interrupted, activityRunId: null }, { ...contact, source: 'unknown' as const },
      { ...interrupted, cause: 'completed' as const, outcome: 'completed' as const, participation: 'solitary' as const },
    ]) expect(appraiseCausalEvent(createCausalAffectState(), event, 0).emotion).toBeNull();
  });

  it('uses deterministic half-life, drops small affect and caps each stalled tick at 60s', () => {
    const initial = appraiseCausalEvent(createCausalAffectState(), interrupted, 0);
    const half = decayCausalAffect(initial, 30_000);
    expect(half.emotion?.intensity).toBe(0.1);
    expect(decayCausalAffect(half, 60_000).emotion?.intensity).toBe(0.05);
    expect(decayCausalAffect(half, 60_001).emotion).toBeNull();
    const stall = decayCausalAffect(initial, 86400_000);
    expect(stall.emotion?.intensity).toBe(0.05);
    expect(decayCausalAffect(stall, 86400_000).emotion?.intensity).toBe(0.05);
    expect(appraiseCausalEvent(createCausalAffectState(), interrupted, 0)).toEqual(initial);
  });

  it('rejects invalid or reversed clocks and invalid data without changing high water or affect', () => {
    const state = appraiseCausalEvent(createCausalAffectState(), interrupted, 10);
    for (const time of [-1, 9, NaN, Infinity]) {
      expect(decayCausalAffect(state, time)).toBe(state);
      expect(appraiseCausalEvent(state, { ...interrupted, sequence: 2 }, time)).toBe(state);
    }
    for (const event of [{ ...interrupted, sequence: NaN }, { ...interrupted, executedMs: Infinity }, { ...interrupted, executedMs: -1 }]) {
      expect(appraiseCausalEvent(state, event, 20)).toBe(state);
    }
  });
});
