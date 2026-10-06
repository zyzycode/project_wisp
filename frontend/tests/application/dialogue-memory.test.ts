import { afterEach, expect, it, vi } from 'vitest';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { DEFAULT_CHAT_CONTEXT_LIMITS } from '../../src/application/ports/memory-repository.interface';
import type { AIProviderRequest, AIProviderResponse } from '../../src/application/ports/ai-provider.interface';
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function fixture(localMock = true) {
  vi.useFakeTimers(); vi.setSystemTime(0); let id = 0, generation = 0;
  const completed = vi.fn(), publish = vi.fn();
  const generateResponse = vi.fn(async (request: AIProviderRequest): Promise<AIProviderResponse> => ({ requestId: request.requestId, status: 'ok', reply: { text: 'Ответ' }, confidence: 1 }));
  const runtime = new DialogueRuntime({ provider: { getStatus: async () => ({ kind: 'ready' }), generateResponse }, memory: { generation: () => generation, completed, ...(localMock ? { contextLimits: DEFAULT_CHAT_CONTEXT_LIMITS } : {}) }, now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `id-${++id}`, scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }, getCharacterSnapshot: () => new CharacterStateService().getSnapshot(), applyStimulus: vi.fn(), offerIntent: () => ({ status: 'rejected', reason: 'disabled' }), beginThinking: vi.fn(), endThinking: vi.fn(), publish, transaction: commit => commit() });
  runtime.replaceStream('s'); let sequence = 0;
  const send = async () => { runtime.receive({ type: 'send', streamId: 's', conversationId: runtime.getPresentation().conversationId, sequence: ++sequence, text: 'Привет' }); await flush(); };
  return { runtime, completed, publish, generateResponse, send, reset: () => runtime.receive({ type: 'reset', streamId: 's', conversationId: runtime.getPresentation().conversationId, sequence: ++sequence }), setGeneration: (value: number) => { generation = value; } };
}
afterEach(() => vi.useRealTimers());
it('publishes a whole completed pair before persistence and keeps stable user identity', async () => {
  const f = fixture(); await f.send(); expect(f.completed).toHaveBeenCalledTimes(1);
  const turn = f.completed.mock.calls[0]?.[0]; expect(turn).toMatchObject({ memoryGeneration: 0, user: { id: f.generateResponse.mock.calls[0]?.[0].userMessage.id, text: 'Привет' }, assistant: { text: 'Ответ' } });
  expect(f.publish.mock.invocationCallOrder.some(order => order < f.completed.mock.invocationCallOrder[0]!)).toBe(true); f.runtime.dispose();
});
it('hydrates only the first startup conversation and never rehydrates after dialogue reset', async () => {
  const f = fixture(); const context = [{ role: 'wisp' as const, text: 'Старое воспоминание', createdAt: new Date().toISOString() }];
  f.runtime.hydrateInitialContext(context); await f.send(); expect(f.generateResponse.mock.calls[0]?.[0].recentContext).toEqual(context);
  f.reset(); f.runtime.hydrateInitialContext(context); await f.send(); expect(f.generateResponse.mock.calls[1]?.[0].recentContext).toEqual([]); f.runtime.dispose();
});
it('does not send persistent context to a network provider and retains its six-message limit', async () => {
  const f = fixture(false); f.runtime.hydrateInitialContext([{ role: 'wisp', text: 'private stored text', createdAt: new Date().toISOString() }]);
  for (let i = 0; i < 6; i++) await f.send();
  expect(f.generateResponse.mock.calls[0]?.[0].recentContext).toEqual([]); expect(f.generateResponse.mock.calls[5]?.[0].recentContext).toHaveLength(6); f.runtime.dispose();
});
it('keeps the expanded bounded context exclusively for Mock', async () => {
  const f = fixture(); for (let i = 0; i < 7; i++) await f.send(); expect(f.generateResponse.mock.calls[6]?.[0].recentContext).toHaveLength(12); f.runtime.dispose();
});
it('records one shown timeout fallback but ignores a late result after full-memory cancellation', async () => {
  const f = fixture(); let resolve!: (value: AIProviderResponse) => void;
  f.generateResponse.mockImplementation(() => new Promise(yes => { resolve = yes; })); await f.send();
  await vi.advanceTimersByTimeAsync(15000); expect(f.completed).toHaveBeenCalledTimes(1);
  f.runtime.cancelForMemoryReset(); f.setGeneration(1); f.runtime.clearMemoryContext();
  resolve({ requestId: f.generateResponse.mock.calls[0]![0].requestId, status: 'ok', reply: { text: 'Late' }, confidence: 1 }); await flush(); expect(f.completed).toHaveBeenCalledTimes(1); f.runtime.dispose();
});
it('does not persist half a turn cancelled before its terminal result', async () => {
  const f = fixture(); f.generateResponse.mockReturnValue(new Promise(() => {})); await f.send(); f.runtime.clearMemoryContext(); await vi.advanceTimersByTimeAsync(15000); expect(f.completed).not.toHaveBeenCalled(); f.runtime.dispose();
});
