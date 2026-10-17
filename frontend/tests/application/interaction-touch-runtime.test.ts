import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AIEventRuntime } from '../../src/application/services/ai-event-runtime';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { TouchReactionContext } from '../../src/application/services/touch-reaction-context';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import type { IAIEventProvider, AIEventProviderResponse } from '../../src/application/ports/ai-event-provider.interface';
import type { IAIProvider } from '../../src/application/ports/ai-provider.interface';
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const positive = { category: 'supportive', intensity: 'low', confidence: 'clear' } as const;
const neutral = { category: 'neutral', intensity: 'low', confidence: 'clear' } as const;
const scheduler = { setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms), clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
function fixture(energy = 85, friendship = 0) {
  let id = 0, sequence = 0, generation = 0, allowed = true;
  const character = new CharacterStateService({ now: () => 0, monotonicNow: Date.now });
  const state = character.getState(); state.needs = { ...state.needs, energy }; state.relationship.friendship = friendship; character.replaceRestoredState(state);
  const context = new TouchReactionContext(character, Date.now);
  const generateEvent = vi.fn<IAIEventProvider['generateEvent']>(async request => ({ requestId: request.requestId, replyText: 'Спасибо!', appraisal: request.interaction?.effectPolicy === 'suppressed' ? neutral : positive }));
  const transaction = vi.fn((commit: () => void) => commit()), cancel = vi.fn();
  const runtime = new AIEventRuntime({ provider: { generateEvent, cancel }, touchContext: context, transaction,
    now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `r${++id}`, scheduler, random: () => .99,
    character: () => character.getSnapshot(), publish: vi.fn(), gate: () => ({ identity: 's:c:0', memoryGeneration: generation, allowed, activeRunId: null, localSpeech: false }) });
  return { runtime, context, character, generateEvent, transaction, cancel,
    touch: () => runtime.touch(character.beginTouch(++sequence)), memory: () => { generation++; runtime.invalidate(); }, drag: () => { allowed = false; runtime.tick(); } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => vi.useRealTimers());
it.each([[85, 0], [25, 450]])('uses factual touch, post-base character and bounded reward energy=%s friendship=%s', async (energy, friendship) => {
  const f = fixture(energy, friendship); vi.setSystemTime(30000); f.touch(); await flush();
  const request = f.generateEvent.mock.calls[0]?.[0];
  expect(request?.event).toMatchObject({ type: 'user_touch', variant: 'touch' });
  expect(request?.characterSnapshot.needs.energy).toBeCloseTo(energy - .2);
  expect(f.character.getState().relationship.friendship).toBe(friendship + 2);
  expect(f.context.get()).toMatchObject({ effect: 'accepted', publishedText: 'Спасибо!', energyBand: energy <= 30 ? 'tired' : 'rested' });
  expect(f.transaction).toHaveBeenCalledOnce(); f.runtime.dispose();
});
it('normal drift allows current-state commit; changed band publishes local factual fallback', async () => {
  const f = fixture(30.1); vi.setSystemTime(30000);
  let resolve!: (value: AIEventProviderResponse) => void;
  f.generateEvent.mockImplementationOnce(() => new Promise(yes => { resolve = yes; })); f.touch(); await flush();
  const snapshot = f.character.getState(); snapshot.needs = { ...snapshot.needs, energy: 19 };
  // A restored state also rotates the generation; no old proposal may cross it.
  f.character.replaceRestoredState(snapshot); resolve({ requestId: f.generateEvent.mock.calls[0]![0].requestId, replyText: 'Спасибо!', appraisal: positive }); await flush();
  expect(f.runtime.getSpeech()?.text).toBe('Я заметила касание.'); expect(f.context.get()?.reason).toBe('state_changed');
  expect(f.character.getState().relationship.friendship).toBe(0); f.runtime.dispose();
});
it.each(['offline', 'malformed', 'extra', 'wrong_id', 'timeout'])('publishes one labelled local fallback for %s', async action => {
  const f = fixture(); vi.setSystemTime(30000);
  if (action === 'offline') f.generateEvent.mockRejectedValueOnce(new Error('offline'));
  if (action === 'malformed') f.generateEvent.mockImplementationOnce(async r => ({ requestId: r.requestId, replyText: 'Bad' }));
  if (action === 'extra') f.generateEvent.mockImplementationOnce(async r => ({ requestId: r.requestId, replyText: 'Bad', appraisal: positive, extra: true }));
  if (action === 'wrong_id') f.generateEvent.mockResolvedValueOnce({ requestId: 'wrong', replyText: 'Bad', appraisal: positive });
  if (action === 'timeout') f.generateEvent.mockImplementationOnce(() => new Promise(() => undefined));
  f.touch(); await flush(); if (action === 'timeout') await vi.advanceTimersByTimeAsync(15000);
  expect(f.runtime.getSpeech()?.text).toBe('Я заметила касание.'); expect(f.context.get()).toMatchObject({ effect: 'rejected', reason: 'unavailable', appraisal: { confidence: 'uncertain' } });
  expect(f.character.getState().relationship.friendship).toBe(0); expect(f.generateEvent).toHaveBeenCalledOnce(); f.runtime.dispose();
});
it.each(['reset', 'dispose', 'memory', 'drag'])('silences late response after %s', async action => {
  const f = fixture(); vi.setSystemTime(30000); let resolve!: (value: AIEventProviderResponse) => void;
  f.generateEvent.mockImplementationOnce(() => new Promise(yes => { resolve = yes; })); f.touch(); await flush();
  if (action === 'reset') f.runtime.invalidate(); if (action === 'dispose') f.runtime.dispose(); if (action === 'memory') f.memory(); if (action === 'drag') f.drag();
  resolve({ requestId: f.generateEvent.mock.calls[0]![0].requestId, replyText: 'Late', appraisal: positive }); await flush();
  expect(f.runtime.getSpeech()).toBeNull(); expect(f.context.get()).toBeUndefined(); expect(f.character.getState().relationship.friendship).toBe(0); f.runtime.dispose();
});
it('follow-up receives published trace repeatedly, suppressed chat appraisal gives no second reward', async () => {
  const f = fixture(); vi.setSystemTime(30000); f.touch(); await flush(); let id = 0;
  const generateResponse = vi.fn<IAIProvider['generateResponse']>(async r => ({ requestId: r.requestId, status: 'ok', confidence: 1, reply: { text: 'Я заметила твоё касание.' }, appraisal: neutral }));
  const chat = new DialogueRuntime({ interactionEnabled: true, events: f.runtime, provider: { getStatus: async () => ({ kind: 'ready' }), generateResponse },
    now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `chat-${++id}`, scheduler,
    getCharacterSnapshot: () => f.character.getSnapshot(), applyStimulus: s => { f.character.applyStimulus(s); },
    beginThinking: vi.fn(), endThinking: vi.fn(), transaction: commit => commit(), publish: vi.fn(), offerIntent: vi.fn() });
  chat.replaceStream('s'); // Stream initialization invalidates previous context; publish a fresh touch.
  f.touch(); await flush(); const prior = f.context.get(); expect(prior).toBeDefined();
  const send = (sequence: number) => chat.receive({ type: 'send', sequence, streamId: 's', conversationId: chat.getPresentation().conversationId, text: 'Почему?' });
  const friendship = f.character.getState().relationship.friendship;
  send(1); await flush(); send(2); await flush();
  expect(generateResponse).toHaveBeenCalledTimes(2);
  for (const [request] of generateResponse.mock.calls) { expect(request.interaction).toMatchObject({ effectPolicy: 'suppressed', previousTouch: prior }); expect(request.recentContext.some(p => p.text === 'Спасибо!')).toBe(false); }
  expect(f.character.getState().relationship.friendship).toBe(friendship + 12); // one legacy chat reward per user turn until #90
  chat.clearMemoryContext(); expect(f.context.get()).toBeUndefined(); chat.dispose(); f.runtime.dispose();
});
it('pending transport skips further requests while later input still applies its bounded base', async () => {
  const f = fixture(); vi.setSystemTime(30000); let resolve!: (value: AIEventProviderResponse) => void;
  f.generateEvent.mockImplementationOnce(() => new Promise(yes => { resolve = yes; })); f.touch(); await flush();
  vi.setSystemTime(40000); f.touch(); await flush();
  expect(f.generateEvent).toHaveBeenCalledOnce(); expect(f.character.getState().needs.attention).toBe(31);
  resolve({ requestId: f.generateEvent.mock.calls[0]![0].requestId, replyText: 'Спасибо!', appraisal: positive }); await flush();
  expect(f.character.getState().relationship.friendship).toBe(2); f.runtime.dispose();
});
it('follow-up refreshes TTL after waiting for transport settlement', async () => {
  const f = fixture(); let id = 0, release!: () => void;
  const settled = new Promise<void>(yes => { release = yes; });
  const generateResponse = vi.fn<IAIProvider['generateResponse']>(async r => ({ requestId: r.requestId, status: 'ok', confidence: 1, reply: { text: 'Да.' }, appraisal: neutral }));
  const chat = new DialogueRuntime({ interactionEnabled: true, events: { invalidate: () => f.runtime.invalidate(), takePreviousInitiative: () => f.runtime.takePreviousInitiative(), getPreviousTouch: () => f.runtime.getPreviousTouch(), interruptForUser: () => settled },
    provider: { getStatus: async () => ({ kind: 'ready' }), generateResponse }, now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `ttl-${++id}`, scheduler,
    getCharacterSnapshot: () => f.character.getSnapshot(), applyStimulus: vi.fn(), beginThinking: vi.fn(), endThinking: vi.fn(), transaction: commit => commit(), publish: vi.fn(), offerIntent: vi.fn() });
  chat.replaceStream('s'); vi.setSystemTime(30000); f.touch(); await flush(); vi.setSystemTime(629999);
  chat.receive({ type: 'send', sequence: 1, text: 'Почему?', streamId: 's', conversationId: chat.getPresentation().conversationId }); await flush();
  vi.setSystemTime(630000); release(); await flush();
  expect(generateResponse.mock.calls[0]?.[0].interaction?.previousTouch).toBeUndefined(); chat.dispose(); f.runtime.dispose();
});
it('a result exactly at deadline can publish only local fallback even before timer delivery', async () => {
  const f = fixture(); vi.setSystemTime(30000); let resolve!: (value: AIEventProviderResponse) => void;
  f.generateEvent.mockImplementationOnce(() => new Promise(yes => { resolve = yes; })); f.touch(); await flush();
  vi.setSystemTime(45000); resolve({ requestId: f.generateEvent.mock.calls[0]![0].requestId, replyText: 'Спасибо!', appraisal: positive }); await flush();
  expect(f.runtime.getSpeech()?.text).toBe('Я заметила касание.'); expect(f.character.getState().relationship.friendship).toBe(0); f.runtime.dispose();
});
