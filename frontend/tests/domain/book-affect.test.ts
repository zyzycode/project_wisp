import { expect, it } from 'vitest';
import { appraiseCausalEvent, createCausalAffectState, decayCausalAffect, reappraiseInterruption,
  relieveCausalInterruption, type CausalObservedEvent } from '../../src/domain/character/causal-affect';
import { directCausalExpression } from '../../src/domain/character/causal-director';
import { createCopingState, observeCoping } from '../../src/domain/character/coping';
import { causalRelationshipDeltas } from '../../src/domain/character/relationship-facets';

const event: CausalObservedEvent = { sequence: 2, source: 'user', triggerSequence: 1, activityRunId: 'book', activity: 'book',
  outcome: 'cancelled', cause: 'user_interrupted', executedMs: 1000, participation: 'solitary' };
it('keeps book affect low and solitary without cursor repetition, facets, coping or report relief', () => {
  let state = createCausalAffectState();
  for (let sequence = 2; sequence < 8; sequence++) state = appraiseCausalEvent(state, { ...event, sequence }, 0);
  expect(state.emotion).toMatchObject({ activity: 'book', kind: 'irritated', intensity: .1, target: 'user' });
  expect(state.interruptionTimes).toEqual([]);
  expect(causalRelationshipDeltas(event, true)).toBeNull();
  expect(observeCoping(createCopingState(), { ...event, appRunId: 'app', revision: 1 }, state.emotion, 0, 0).opportunity).toBeNull();
  expect(reappraiseInterruption(state, 7, 'reported_accidental', 0).emotion?.intensity).toBe(.1);
  expect(relieveCausalInterruption(state, 7, 0).emotion?.intensity).toBe(.1);
  expect(decayCausalAffect(state, 10_000).emotion?.activity).toBe('book');
  expect(appraiseCausalEvent(createCausalAffectState(), { ...event, executedMs: 999 }, 0).emotion).toBeNull();
});
it('projects only the current selected activity and forbids book invitations or contact interest', () => {
  const emotion = appraiseCausalEvent(createCausalAffectState(), event, 0).emotion;
  expect(directCausalExpression(emotion, true, 'emerging')?.expression).toMatchObject({ activity: 'book', intensity: 'low', ownActivityInterest: 'emerging', deferredInvitation: false });
  const contact = appraiseCausalEvent(createCausalAffectState(), { ...event, source: 'user', activity: null, activityRunId: null,
    outcome: null, cause: 'contact', executedMs: 0, participation: 'none', triggerSequence: null }, 0).emotion;
  expect(directCausalExpression(contact, true, 'established')?.expression).toMatchObject({ activity: 'contact', ownActivityInterest: 'none', deferredInvitation: false });
  expect(directCausalExpression(null, true, 'established')).toBeUndefined();
});
