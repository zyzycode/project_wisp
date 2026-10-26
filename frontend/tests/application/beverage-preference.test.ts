import { describe, expect, it, vi } from 'vitest';
import { BeverageDialogue, recognizeBeverageCorrection } from '../../src/application/services/beverage-preference';
import type { BeveragePreference } from '../../src/application/ports/memory-beverage.interface';
const item: BeveragePreference = { ref: { itemId: 'item', revision: 1 }, category: 'beverage_preference', value: 'coffee', provenance: 'model_proposal', validity: 'hypothesis', manuallyCorrected: false, status: 'active', source: { userMessageId: 'user', assistantMessageId: 'assistant' }, evidenceQuote: 'Кофе', updatedAt: '2026-10-26T00:00:00.000Z' };
function fixture(current: BeveragePreference | null = item) {
  let generation = 0, tokenCurrent = true;
  const mutateBeverage = vi.fn(async () => { generation++; return { ok: true as const, value: { commandId: 'command', ref: { itemId: 'item', revision: 2 }, outcome: 'withdrawn' as const } }; });
  const readBeverage = vi.fn(async () => ({ ok: true as const, value: current }));
  const dialogue = new BeverageDialogue({ runtime: () => ({ context: () => ({ generation }), readBeverage, mutateBeverage }), createId: () => 'id', timestamp: () => '2026-10-26T00:00:00.000Z', now: () => 0, isAdmissionCurrent: () => tokenCurrent });
  return { dialogue, readBeverage, mutateBeverage, invalidate: () => { tokenCurrent = false; }, admission: { text: 'Нет, предпочитаю чай', replyToTopic: false, admissionToken: {}, deadlineMs: 200 } };
}
describe('narrow beverage correction', () => {
  it.each(['Я предпочитаю чай', 'Нет, предпочитаю чай.', 'нет, я предпочитаю чай!', ' I prefer tea ', 'No, I prefer tea?'])('accepts the full supported utterance %s', text => { expect(recognizeBeverageCorrection(text)).toBe('tea'); });
  it.each(['хочу кофе', 'предпочитаю чай', 'Он сказал: я предпочитаю чай', 'Нет, предпочитаю чай. Спасибо', 'I want tea', 'No, I prefer tea!!', 'нет, люблю чай'])('does not infer from %s', text => { expect(recognizeBeverageCorrection(text)).toBeNull(); });
  it('withdraws before returning a trusted post-withdraw correction binding', async () => { const f = fixture(); expect(await f.dialogue.admit(f.admission, { generation: 0 })).toEqual({ ok: true, value: { generation: 1, correction: { expected: { itemId: 'item', revision: 2 }, value: 'tea' } } }); expect(f.mutateBeverage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'withdraw', expected: item.ref }), f.admission.admissionToken); });
  it('gives explicit topic reply priority without reading or withdrawing preference', async () => { const f = fixture(); expect(await f.dialogue.admit({ ...f.admission, replyToTopic: true }, { generation: 0 })).toEqual({ ok: true, value: { generation: 0 } }); expect(f.readBeverage).not.toHaveBeenCalled(); expect(f.mutateBeverage).not.toHaveBeenCalled(); });
  it('does not create a record from conversation without an existing slot', async () => { const f = fixture(null); await f.dialogue.admit(f.admission, { generation: 0 }); expect(f.mutateBeverage).not.toHaveBeenCalled(); });
  it('does not withdraw active confirmed same value', async () => { const f = fixture({ ...item, validity: 'confirmed', value: 'tea' }); await f.dialogue.admit(f.admission, { generation: 0 }); expect(f.mutateBeverage).not.toHaveBeenCalled(); });
  it('keeps opt-in independent from future projection consent', async () => { const f = fixture(); expect(await f.dialogue.prepare({ requestId: 'r', userMessageId: 'u', allowProposal: false }, { generation: 0 })).toMatchObject({ value: { context: { allowProposal: false, current: { value: 'coffee', validity: 'hypothesis' } } } }); });
  it('omits absent inactive record without proposal opt-in', async () => { const f = fixture({ ...item, status: 'withdrawn' }); expect(await f.dialogue.prepare({ requestId: 'r', userMessageId: 'u', allowProposal: false }, { generation: 0 })).toEqual({ ok: true, value: null }); });
  it('expires an opaque offer and never resolves another offer ID', () => { const f = fixture(); f.dialogue.offer({ value: 'tea', evidenceQuote: 'tea' }, item.source, 0); expect(f.dialogue.resolveOffer('other')).toBeNull(); expect(f.dialogue.resolveOffer('id')).not.toBeNull(); f.dialogue.invalidateOffer(); expect(f.dialogue.resolveOffer('id')).toBeNull(); });
});
