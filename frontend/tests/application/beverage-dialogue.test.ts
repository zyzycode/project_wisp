import { afterEach, expect, it, vi } from 'vitest';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import type { IBeverageDialogue } from '../../src/application/ports/memory-beverage.interface';
import type { AIProviderRequest } from '../../src/application/ports/ai-provider.interface';
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(0); let id = 0, generation = 0;
  const persisted = deferred<boolean>();
  const beverage: IBeverageDialogue = {
    invalidateOffer: vi.fn(),
    admit: vi.fn<IBeverageDialogue['admit']>(async () => ({ ok: true, value: { generation } })),
    prepare: vi.fn<IBeverageDialogue['prepare']>(async input => ({ ok: true, value: input.allowProposal ? { generation, context: { allowProposal: true } } : null })),
    offer: vi.fn((proposal, source) => ({ proposal, source, offerId: 'offer' })), resolveOffer: vi.fn(() => null), isCurrent: () => true,
  };
  const completed = vi.fn((_turn: import('../../src/application/ports/memory-runtime').CompletedDialogueMemoryTurn) => persisted.promise);
  const provider = { getStatus: vi.fn(async () => ({ kind: 'ready' as const })), generateResponse: vi.fn(async (request: AIProviderRequest) => ({ requestId: request.requestId, status: 'ok' as const, confidence: 1, reply: { text: 'Похоже, ты любишь чай?' }, beverageProposal: { value: 'tea' as const, evidenceQuote: request.userMessage.text } })) };
  const runtime = new DialogueRuntime({ provider, now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `id-${++id}`, scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }, getCharacterSnapshot: () => new CharacterStateService().getSnapshot(), applyStimulus: vi.fn(), offerIntent: vi.fn(), publish: vi.fn(), beginThinking: vi.fn(), endThinking: vi.fn(), transaction: fn => fn(), memory: { beverage, generation: () => generation, completed } });
  runtime.replaceStream('stream');
  const send = (sequence: number, optin = false, text = 'Пью чай') => runtime.receive({ type: 'send', text, streamId: 'stream', conversationId: runtime.getPresentation().conversationId, sequence, ...(optin ? { requestBeverageProposal: true } : {}) });
  return { runtime, send, provider, beverage, persisted, completed, advanceGeneration: () => { generation++; } };
}
afterEach(() => vi.useRealTimers());
it('publishes an opaque offer only after acknowledged successful append', async () => { const f = fixture(); f.send(1, true); await flush(); expect(f.beverage.offer).not.toHaveBeenCalled(); expect(f.completed).toHaveBeenCalledWith(expect.objectContaining({ beverageProposalSource: true, memoryConfirmable: true })); f.persisted.resolve(true); await flush(); expect(f.runtime.getPresentation().turn).toMatchObject({ beverageOffer: { offerId: 'offer', value: 'tea' } }); });
it('never reopens an old offer after next send in the same memory generation', async () => { const f = fixture(); f.send(1, true); await flush(); f.send(2); await flush(); f.persisted.resolve(true); await flush(); expect(f.beverage.offer).not.toHaveBeenCalled(); expect(f.runtime.getPresentation().turn).not.toHaveProperty('beverageOffer'); });
it.each(['reset', 'reload', 'dispose', 'mutation', 'append failure'])('does not publish a late committed offer after %s', async mode => { const f = fixture(); f.send(1, true); await flush(); if (mode === 'reset') f.runtime.receive({ type: 'reset', streamId: 'stream', conversationId: f.runtime.getPresentation().conversationId, sequence: 2 }); if (mode === 'reload') f.runtime.replaceStream('new'); if (mode === 'dispose') f.runtime.dispose(); if (mode === 'mutation') { f.advanceGeneration(); f.runtime.clearMemoryContext(); } f.persisted.resolve(mode !== 'append failure'); await flush(); expect(f.beverage.offer).not.toHaveBeenCalled(); });
it('does not offer a model proposal without independent per-turn opt-in', async () => { const f = fixture(); f.send(1); await flush(); f.persisted.resolve(true); await flush(); expect(f.beverage.offer).not.toHaveBeenCalled(); expect(f.completed.mock.calls[0]?.[0]).not.toHaveProperty('beverageProposalSource'); });
it.each(['failure', 'timeout'])('does not dispatch a recognized correction without durable withdraw acknowledgment: %s', async mode => { const f = fixture(); if (mode === 'failure') vi.mocked(f.beverage.admit).mockResolvedValue({ ok: false, code: 'io_error' }); else vi.mocked(f.beverage.admit).mockImplementation(() => new Promise(() => {})); f.send(1, false, 'Нет, предпочитаю чай'); await flush(); if (mode === 'timeout') { await vi.advanceTimersByTimeAsync(201); await flush(); } expect(f.provider.generateResponse).not.toHaveBeenCalled(); expect(f.runtime.getPresentation().canSubmit).toBe(true); });
it('excludes a bound pending correction pair from volatile context and forwards fallback binding', async () => { const f = fixture(); vi.mocked(f.beverage.admit).mockResolvedValue({ ok: true, value: { generation: 0, correction: { expected: { itemId: 'item', revision: 2 }, value: 'tea' } } }); f.send(1, false, 'Нет, предпочитаю чай'); await flush(); expect(f.completed).toHaveBeenCalledWith(expect.objectContaining({ beverageCorrection: expect.objectContaining({ value: 'tea', requestId: expect.any(String), userMessageId: expect.any(String) }) })); f.send(2); await flush(); expect(f.provider.generateResponse.mock.calls[1]?.[0].recentContext).toEqual([]); });

it('keeps opt-in with current projection consumer-only, never reusing output as a new proposal source', async () => {
  const f = fixture(); vi.mocked(f.beverage.prepare).mockImplementation(async input => ({ ok: true, value: { generation: 0, context: { allowProposal: true, current: { value: 'coffee', validity: 'confirmed' } }, use: { expected: { itemId: 'item', revision: 1 }, requestId: input.requestId, userMessageId: input.userMessageId } } }));
  f.send(1, true); await flush(); expect(f.completed).toHaveBeenCalledWith(expect.objectContaining({ beverageUse: expect.objectContaining({ expected: { itemId: 'item', revision: 1 } }) }));
  expect(f.completed.mock.calls[0]?.[0]).not.toHaveProperty('beverageProposalSource');
  f.persisted.resolve(true); await flush(); expect(f.beverage.offer).not.toHaveBeenCalled();
});
it('does not create a proposal source or offer when transport atomically drops the optional block', async () => { const f = fixture(); Object.assign(f.provider, { canIncludeBeverage: () => false }); f.send(1, true); await flush(); expect(f.completed.mock.calls[0]?.[0]).not.toHaveProperty('beverageProposalSource'); expect(f.completed.mock.calls[0]?.[0]).not.toHaveProperty('beverageUse'); f.persisted.resolve(true); await flush(); expect(f.beverage.offer).not.toHaveBeenCalled(); });
