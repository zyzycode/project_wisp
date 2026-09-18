import { afterEach, expect, it, vi } from 'vitest';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { LocalMemoryRecall, emptyMemoryContext } from '../../src/application/services/memory-recall';
import type { AIProviderRequest, IAIProvider } from '../../src/application/ports/ai-provider.interface';
import type { AIProviderMemoryContext, ILocalMemoryRecall } from '../../src/application/ports/memory-knowledge.interface';
import type { MemoryResult } from '../../src/application/ports/memory-repository.interface';
import { providerRequest } from '../infrastructure/backend-ai-fixture';
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function fixture(recall: ILocalMemoryRecall) {
  let id = 0, generation = 0;
  const generateResponse = vi.fn<IAIProvider['generateResponse']>(async request => ({ requestId: request.requestId, status: 'ok', confidence: 1, reply: { text: 'Ответ' } }));
  const completed = vi.fn();
  const runtime = new DialogueRuntime({ provider: { getStatus: async () => ({ kind: 'ready' }), generateResponse },
    memory: { generation: () => generation, recall, completed }, now: Date.now, timestamp: () => '2026-09-18T00:00:00.000Z', createId: () => `id-${++id}`,
    scheduler: { setTimeout, clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) }, getCharacterSnapshot: () => providerRequest().characterSnapshot,
    transaction: commit => commit(), applyStimulus: vi.fn(), beginThinking: vi.fn(), endThinking: vi.fn(), publish: vi.fn(), offerIntent: vi.fn() });
  runtime.replaceStream('s');
  const send = (sequence: number) => runtime.receive({ type: 'send', text: 'игра', sequence, streamId: 's', conversationId: runtime.getPresentation().conversationId });
  return { runtime, generateResponse, completed, send, reset: () => { generation++; runtime.clearMemoryContext(); } };
}
afterEach(() => vi.useRealTimers());
it('recalls before one generation request while keeping current Character and excluding volatile source IDs next turn', async () => {
  const memory = { ...emptyMemoryContext(), facts: [{ key: 'user.display_name' as const, value: 'Мария' }] };
  const recall = vi.fn<ILocalMemoryRecall['recall']>(async () => ({ ok: true, value: memory }));
  const f = fixture({ recall }); f.send(1); await flush();
  expect(f.generateResponse).toHaveBeenCalledTimes(1); expect(f.generateResponse.mock.calls[0]?.[0]).toMatchObject({ memoryContext: memory, characterSnapshot: providerRequest().characterSnapshot });
  const saved = f.completed.mock.calls[0]?.[0]; f.send(2); await flush();
  expect(recall.mock.calls[1]?.[0].excludedMessageIds).toEqual([saved.user.id, saved.assistant.id]);
  expect(f.generateResponse.mock.calls[1]?.[0].recentContext).toHaveLength(2);
  f.runtime.dispose();
});
it.each(['reset', 'dispose'])('does not generate or persist a late recall after%s', async action => {
  let resolve!: (value: MemoryResult<AIProviderMemoryContext>) => void;
  const f = fixture({ recall: () => new Promise(yes => { resolve = yes; }) }); f.send(1); await flush();
  if (action === 'reset') f.reset(); else f.runtime.dispose();
  resolve({ ok: true, value: emptyMemoryContext() }); await flush();
  expect(f.generateResponse).not.toHaveBeenCalled(); expect(f.completed).not.toHaveBeenCalled();
});
it('sends empty memory after the total200ms storage budget and never applies a late read', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  let resolve!: (value: MemoryResult<readonly never[]>) => void;
  const recall = new LocalMemoryRecall({ facts: { list: () => new Promise(yes => { resolve = yes; }), upsert: vi.fn(), removeByKey: vi.fn() }, history: { getRecent: async () => ({ ok: true, value: [] }), appendTurn: vi.fn(), closeSession: vi.fn(), closeUnfinishedSessions: vi.fn() }, gameReader: { getRecent: async () => ({ ok: true, value: [] }) }, scheduler: { setTimeout, clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) }, isCurrent: () => true, preference: () => undefined, onFailure: vi.fn() });
  const f = fixture(recall); f.send(1); await flush(); expect(f.generateResponse).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(200); expect(f.generateResponse).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ memoryContext: emptyMemoryContext() }));
  resolve({ ok: true, value: [] }); await flush(); expect(f.generateResponse).toHaveBeenCalledTimes(1); f.runtime.dispose();
});
it('does not expose candidate hallucinations as state updates and shows reply before asynchronous persistence', async () => {
  const f = fixture({ recall: async () => ({ ok: false, code: 'unavailable' }) });
  f.generateResponse.mockImplementationOnce(async (request: AIProviderRequest) => ({ requestId: request.requestId, status: 'ok', confidence: 1, reply: { text: 'Ответ' }, memoryCandidates: [{ key: 'user.display_name', value: 'Invented', evidenceQuote: 'игра' }] }));
  f.completed.mockImplementation(() => new Promise(() => undefined)); f.send(1); await flush();
  expect(f.runtime.getPresentation().turn).toMatchObject({ phase: 'completed', replyText: 'Ответ' });
  expect(f.completed.mock.calls[0]?.[0]).not.toHaveProperty('memoryCandidates'); f.runtime.dispose();
});
