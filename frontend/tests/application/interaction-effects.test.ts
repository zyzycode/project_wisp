import { expect, it } from 'vitest';
import { CharacterStateService } from '../../src/application/services/character-state.service';
it('provider response never rewards a second time', () => {
  const service = new CharacterStateService({ now: () => 0 });
  service.applyStimulus({ type: 'user_message', source: 'user' });
  const before = service.getState();
  service.applyStimulus({ type: 'provider_response', source: 'provider' });
  expect(service.getState()).toEqual(before);
});

import { TouchReactionContext } from '../../src/application/services/touch-reaction-context';
import { interactionSignature } from '../../src/domain/character/interaction-effects';
const supportive = { category: 'supportive', intensity: 'low', confidence: 'clear' } as const;
function fixture() {
  let now = 0;
  const service = new CharacterStateService({ now: () => 0, monotonicNow: () => now });
  return { service, time: (value: number) => { now = value; }, context: new TouchReactionContext(service, () => now) };
}
it('bounds click family base and keeps pet/feed independent', () => {
  const f = fixture(), before = f.service.getState();
  f.service.beginTouch(1); f.service.beginTouch(1);
  f.service.applyStimulus({ type: 'user_double_click' });
  f.service.applyStimulus({ type: 'user_right_click' });
  expect(f.service.getState().needs).toEqual({ ...before.needs, attention: before.needs.attention - 2, energy: before.needs.energy - .2 });
  expect(f.service.getState().relationship).toEqual(before.relationship);
  f.time(10000); f.service.beginTouch(4);
  expect(f.service.getState().needs.attention).toBe(before.needs.attention - 4);
  f.service.applyStimulus({ type: 'pet' }); expect(f.service.getState().relationship.friendship).toBe(4);
});
it('30s gate, once-only receipt, uncertainty and restart prevent farming', () => {
  const f = fixture();
  expect(f.service.commitTouch(f.service.beginTouch(1), supportive)).toEqual({ effect: 'suppressed', reason: 'cooldown' });
  f.time(30000); const receipt = f.service.beginTouch(2);
  expect(f.service.commitTouch(receipt, supportive).effect).toBe('accepted');
  expect(f.service.commitTouch(receipt, supportive).effect).toBe('rejected');
  expect(f.service.getState().relationship.friendship).toBe(2);
  const uncertain = f.service.beginTouch(3);
  expect(f.service.commitTouch(uncertain, { ...supportive, confidence: 'uncertain' }).effect).toBe('neutral');
  f.time(60000); expect(f.service.commitTouch(f.service.beginTouch(4), supportive).effect).toBe('accepted');
  const saved = f.service.getState(); f.service.replaceRestoredState(saved);
  expect(f.service.commitTouch(f.service.beginTouch(5), supportive).effect).toBe('suppressed');
  expect(f.service.commitTouch(receipt, supportive).effect).toBe('rejected');
});
it('allows drift within signature bands, rejects crossed bands and current consent changes', () => {
  const f = fixture(); f.time(30000); const receipt = f.service.beginTouch(1);
  f.service.tickNeeds(1000);
  expect(f.service.commitTouch(receipt, supportive).effect).toBe('accepted');
  const snapshot = f.service.getSnapshot();
  expect(interactionSignature(snapshot)).not.toBe(interactionSignature({ ...snapshot, intimacy: { ...snapshot.intimacy, userConsentEnabled: true } }));
  expect(interactionSignature(snapshot)).not.toBe(interactionSignature({ ...snapshot, needs: { ...snapshot.needs, energy: 20 } }));
  f.time(60000); const stale = f.service.beginTouch(2); f.service.applyStimulus({ type: 'pet', intensity: 3 });
  // Changed traits/tone is represented by a signature, never by broad lastUpdated.
  expect(f.service.commitTouch({ ...stale, signature: 'old' }, supportive).reason).toBe('state_changed');
});
it('clamps permitted changes and preserves love, intimacy and personality', () => {
  const f = fixture(), state = f.service.getState(); state.relationship.friendship = 999; state.needs = { ...state.needs, comfort: .5 };
  f.service.replaceRestoredState(state); f.time(30000);
  const receipt = f.service.beginTouch(1), before = f.service.getState();
  expect(f.service.commitTouch(receipt, supportive).effect).toBe('accepted');
  const after = f.service.getState(); expect(after.relationship.friendship).toBe(1000); expect(after.needs.comfort).toBe(0);
  expect(after.intimacy).toEqual(before.intimacy); expect(after.personality).toEqual(before.personality); expect(after.relationship.love).toBe(before.relationship.love);
});
it('stores only published reaction, non-consuming for 10min, clear and restart discard it', () => {
  const f = fixture(); f.time(30000);
  const text = f.context.publish(f.service.beginTouch(1), '2026-10-17T00:00:00Z', 'Спасибо!', supportive, 'ru');
  expect(text).toBe('Спасибо!'); expect(f.context.get()?.effect).toBe('accepted'); expect(f.context.get()?.publishedText).toBe(text);
  f.time(629999); expect(f.context.get()).toBeDefined(); f.time(630000); expect(f.context.get()).toBeUndefined();
  f.context.publish(f.service.beginTouch(2), '2026-10-17T00:00:01Z', undefined, undefined, 'ru');
  expect(f.context.get()).toMatchObject({ publishedText: 'Я заметила касание.', effect: 'rejected', reason: 'unavailable', appraisal: { confidence: 'uncertain' } });
  f.context.clear(); expect(f.context.get()).toBeUndefined(); expect(new TouchReactionContext(f.service, () => 0).get()).toBeUndefined();
});
it('retires rejected sequence permanently, even if its signature later matches', () => {
  const f = fixture(); f.time(30000); const receipt = f.service.beginTouch(1);
  expect(f.service.commitTouch({ ...receipt, signature: 'changed' }, supportive).effect).toBe('rejected');
  expect(f.service.commitTouch(receipt, supportive).effect).toBe('rejected');
  expect(f.service.getState().relationship.friendship).toBe(0);
});
it('click never changes axes and pet retains the independent five minute adaptation gate', () => {
  const f = fixture(); f.time(300000); const initial = f.service.getState().personality.axes;
  f.service.beginTouch(1); f.time(310000); f.service.beginTouch(2);
  expect(f.service.getState().personality.axes).toEqual(initial);
  f.service.applyStimulus({ type: 'pet', source: 'user' }); const learned = f.service.getState().personality.axes;
  expect(learned).not.toEqual(initial); f.time(320000); f.service.beginTouch(3); f.service.applyStimulus({ type: 'pet', source: 'user' });
  expect(f.service.getState().personality.axes).toEqual(learned);
});
