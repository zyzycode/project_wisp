import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { DIALOGUE_FALLBACK } from '../../src/application/services/dialogue-provider-result';
import { emptyMemoryContext } from '../../src/application/services/memory-recall';
import { projectCharacterMemory, restoreCharacterMemory } from '../../src/application/services/character-memory-snapshot';
import type { IAIProvider, AIProviderResponse } from '../../src/application/ports/ai-provider.interface';
import type { InteractionAppraisal } from '../../src/application/ports/interaction-appraisal';

const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const neutral: InteractionAppraisal = { category: 'neutral', intensity: 'low', confidence: 'clear' };
const supportive: InteractionAppraisal = { category: 'supportive', intensity: 'low', confidence: 'clear' };
const hostile: InteractionAppraisal = { category: 'hostile', intensity: 'moderate', confidence: 'clear' };
function fixture(proposal: InteractionAppraisal = supportive, energy = 85, friendship = 100) {
  let id = 0, sequence = 0, memoryGeneration = 0;
  const character = new CharacterStateService({ now: () => 0, monotonicNow: Date.now });
  const state = character.getState(); state.needs = { ...state.needs, energy }; state.relationship.friendship = friendship; character.replaceRestoredState(state);
  const generateResponse = vi.fn<IAIProvider['generateResponse']>(async request => ({ requestId: request.requestId, status: 'ok', confidence: 1, reply: { text: 'Ответ модели.' }, appraisal: request.interaction?.effectPolicy === 'suppressed' ? neutral : proposal }));
  const completed = vi.fn(), recall = vi.fn(async () => ({ ok: true as const, value: emptyMemoryContext() })), cancel = vi.fn(), offerIntent = vi.fn();
  const commit = vi.fn((receipt: Parameters<CharacterStateService['commitChat']>[0], appraisal?: InteractionAppraisal) => character.commitChat(receipt, appraisal));
  const runtime = new DialogueRuntime({ provider: { getStatus: async () => ({ kind: 'ready' }), generateResponse, cancel }, interactionEnabled: true,
    beginInteraction: () => character.beginChat(++sequence), commitInteraction: commit, now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `r${++id}`,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }, getCharacterSnapshot: () => character.getSnapshot(), applyStimulus: stimulus => { character.applyStimulus(stimulus); },
    beginThinking: vi.fn(), endThinking: vi.fn(), offerIntent, transaction: operation => operation(), publish: vi.fn(), memory: { generation: () => memoryGeneration, completed, recall: { recall } } });
  runtime.replaceStream('s');
  let commandSequence = 0;
  const send = (text = 'Спасибо, что ты рядом.') => runtime.receive({ type: 'send', sequence: ++commandSequence, streamId: 's', conversationId: runtime.getPresentation().conversationId, text });
  return { character, runtime, generateResponse, completed, recall, cancel, commit, offerIntent, send,
    touch: () => character.beginTouch(++sequence), deleteMemory: () => { memoryGeneration++; runtime.clearMemoryContext(); } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => vi.useRealTimers());
it.each([
  ['supportive', 'moderate', -2, 0, 4],
  ['hostile', 'moderate', 4, 0, -2],
] as const)('commits %s/%s once with text and without AI axes/consent/love writes', async (category, intensity, comfort, play, friendship) => {
  const f = fixture({ category, intensity, confidence: 'clear' }); vi.setSystemTime(30000); const before = f.character.getState();
  f.send(); await flush(); const after = f.character.getState();
  expect(f.generateResponse.mock.calls[0]?.[0]).toMatchObject({ interaction: { effectPolicy: 'eligible' }, characterSnapshot: { needs: { attention: before.needs.attention - 4 } } });
  expect(after.needs).toEqual({ ...before.needs, attention: before.needs.attention - 4, comfort: before.needs.comfort + comfort, play: before.needs.play + play });
  expect(after.relationship.friendship).toBe(before.relationship.friendship + friendship); expect(after.relationship.love).toBe(before.relationship.love);
  expect(after.intimacy).toEqual(before.intimacy); expect(after.personality).toEqual(before.personality); expect(after.preferences).toEqual({});
  expect(f.runtime.getPresentation().turn).toMatchObject({ phase: 'completed', replyText: 'Ответ модели.', outcome: { kind: 'success' } });
  expect(f.commit).toHaveBeenCalledOnce(); expect(f.generateResponse).toHaveBeenCalledOnce(); f.runtime.dispose();
});
it('publishes an uncertain model appraisal without semantic effects', async () => {
  const f = fixture({ category: 'hostile', intensity: 'low', confidence: 'uncertain' }); vi.setSystemTime(30000); const before = f.character.getState();
  f.send('Ну конечно, ты всё знаешь…'); await flush(); const after = f.character.getState();
  expect(after.relationship).toEqual(before.relationship); expect(after.needs.comfort).toBe(before.needs.comfort); expect(after.personality).toEqual(before.personality); expect(after.intimacy).toEqual(before.intimacy);
  expect(f.runtime.getPresentation().turn).toMatchObject({ outcome: { kind: 'success' } }); f.runtime.dispose();
});
it('shared base/appraisal gates include touch and never become network quotas', async () => {
  const f = fixture(); f.send(); await flush(); expect(f.generateResponse.mock.calls[0]?.[0].interaction?.effectPolicy).toBe('suppressed');
  vi.setSystemTime(30000); const touch = f.touch(); expect(f.character.commitTouch(touch, supportive).effect).toBe('accepted');
  f.send(); await flush(); expect(f.generateResponse.mock.calls[1]?.[0].interaction?.effectPolicy).toBe('suppressed');
  const after = f.character.getState(); for (let i = 0; i < 5; i++) { f.send(); await flush(); }
  expect(f.generateResponse).toHaveBeenCalledTimes(7); expect(f.character.getState()).toEqual(after);
  vi.setSystemTime(60000); f.send(); await flush(); expect(f.character.getState().relationship.friendship).toBe(104); f.runtime.dispose();
});
it.each(['state', 'cooldown'])('rejects %s-changed nonzero appraisal and publishes only neutral fallback', async change => {
  const f = fixture(supportive, change === 'state' ? 29.99999 : 85); vi.setSystemTime(30000); let resolve!: (value: AIProviderResponse) => void;
  f.generateResponse.mockImplementationOnce(() => new Promise(yes => { resolve = yes; })); f.send(); await flush();
  if (change === 'state') f.character.tickNeeds(1000);
  else f.character.commitTouch(f.touch(), supportive);
  const before = f.character.getState(); resolve({ requestId: f.generateResponse.mock.calls[0]![0].requestId, status: 'ok', confidence: 1, reply: { text: 'Я стала доверять тебе больше.' }, appraisal: supportive }); await flush();
  expect(f.runtime.getPresentation().turn).toMatchObject({ replyText: DIALOGUE_FALLBACK, outcome: { kind: 'fallback' } });
  expect(f.character.getState()).toEqual(before); expect(f.completed.mock.calls[0]?.[0].memoryConfirmable).toBe(false); expect(f.offerIntent).not.toHaveBeenCalled(); f.runtime.dispose();
});
it.each(['timeout', 'reset', 'dispose', 'delete', 'malformed'])('no late/fallback reward after %s', async change => {
  const f = fixture(); vi.setSystemTime(30000); let resolve!: (value: AIProviderResponse) => void;
  f.generateResponse.mockImplementationOnce(() => new Promise(yes => { resolve = yes; })); f.send(); await flush(); const before = f.character.getState();
  if (change === 'timeout') await vi.advanceTimersByTimeAsync(15000);
  if (change === 'reset') f.runtime.replaceStream('new'); if (change === 'dispose') f.runtime.dispose(); if (change === 'delete') f.deleteMemory();
  resolve({ requestId: f.generateResponse.mock.calls[0]![0].requestId, status: 'ok', confidence: 1, reply: { text: 'Поздно' }, ...(change === 'malformed' ? {} : { appraisal: supportive }) }); await flush();
  expect(f.character.getState()).toEqual(before); if (change === 'malformed') expect(f.runtime.getPresentation().turn).toMatchObject({ outcome: { reason: 'invalid_response' } }); f.runtime.dispose();
});
it('two controlled histories diverge, survive ordinary snapshot restore, and reset to the same card', async () => {
  const positive = fixture({ ...supportive, intensity: 'moderate' }), negative = fixture(hostile);
  for (let i = 1; i <= 3; i++) { vi.setSystemTime(i * 30000); positive.send(); negative.send('Ты мне неприятна.'); await flush(); }
  expect(positive.character.getState().relationship.friendship).toBe(112); expect(negative.character.getState().relationship.friendship).toBe(94);
  const restore = (f: ReturnType<typeof fixture>) => {
    const snapshot = projectCharacterMemory(f.character.getState(), new Date().toISOString());
    const service = new CharacterStateService({ now: () => 0, monotonicNow: Date.now }); service.replaceRestoredState(restoreCharacterMemory(snapshot, service.createDefaults(), 0)); return service;
  };
  const a = restore(positive), b = restore(negative); expect(a.getState().relationship.friendship).toBe(112); expect(b.getState().relationship.friendship).toBe(94);
  expect(a.getState().personality).toEqual(b.getState().personality); expect(a.commitChat(a.beginChat(1), supportive).effect).toBe('suppressed');
  a.resetToDefaults(); b.resetToDefaults(); expect(a.getState()).toEqual(b.getState()); positive.runtime.dispose(); negative.runtime.dispose();
});
it('memory recall/hydrated history and model appraisal never become verified preferences', async () => {
  const f = fixture(); const before = f.character.getState();
  f.runtime.hydrateInitialContext([{ role: 'wisp', text: 'Ты меня поддержал.', createdAt: new Date().toISOString() }]);
  expect(f.character.getState()).toEqual(before); vi.setSystemTime(300000); f.send('Мне нравится игра с курсором'); await flush();
  expect(f.recall).toHaveBeenCalledOnce(); expect(f.character.getState().preferences).toEqual({});
  expect(f.completed.mock.calls[0]?.[0]).not.toHaveProperty('appraisal'); expect(f.character.getState().personality).toEqual(before.personality); f.runtime.dispose();
});
