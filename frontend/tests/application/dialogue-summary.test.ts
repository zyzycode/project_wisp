import { DEFAULT_CHAT_CONTEXT_LIMITS } from '../../src/application/ports/memory-repository.interface';
import type { ILocalMemoryRecall } from '../../src/application/ports/memory-knowledge.interface';
import type { MemoryResult } from '../../src/application/ports/memory-repository.interface';
import type { AIProviderMemoryContext } from '../../src/application/ports/memory-knowledge.interface';
import { expect, it, vi } from 'vitest';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import type { ISummaryRuntime } from '../../src/application/ports/summary';
import type { AIProviderRequest, IAIProvider } from '../../src/application/ports/ai-provider.interface';
import { emptyMemoryContext } from '../../src/application/services/memory-recall';
import { providerRequest } from '../infrastructure/backend-ai-fixture';
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function fixture(canIncludeSummary?: (request: AIProviderRequest) => boolean, localMock = false) {
  let id = 0;
  const summary: ISummaryRuntime = { preview: vi.fn(), confirm: vi.fn(), deleteSummary: vi.fn(), capture: vi.fn(async () => ({ text: 'summary', excludedMessageIds: ['covered-user', 'covered-assistant'], generation: 1 })), isCurrent: vi.fn(() => true), interrupt: vi.fn(), invalidate: vi.fn(), reset: vi.fn(), dispose: vi.fn() };
  const getStatus = vi.fn<IAIProvider['getStatus']>(async () => ({ kind: 'ready' }));
  const generateResponse = vi.fn<IAIProvider['generateResponse']>(async request => ({ requestId: request.requestId, status: 'ok', confidence: 1, reply: { text: 'Ответ' } }));
  const recalled = { ...emptyMemoryContext(), facts: [{ key: 'user.display_name' as const, value: 'Мария' }] };
  const recall = vi.fn<ILocalMemoryRecall['recall']>(async () => ({ ok: true as const, value: recalled }));
  const runtime = new DialogueRuntime({ summary, provider: { getStatus, generateResponse, ...(canIncludeSummary ? { canIncludeSummary } : {}) }, memory: { ...(localMock ? { contextLimits: DEFAULT_CHAT_CONTEXT_LIMITS } : {}), generation: () => 0, recall: { recall }, completed: vi.fn() }, now: () => 0, timestamp: () => '2026-10-17T00:00:00.000Z', createId: () => `id-${++id}`, scheduler: { setTimeout: () => 0, clearTimeout: vi.fn() }, getCharacterSnapshot: () => providerRequest().characterSnapshot, transaction: commit => commit(), applyStimulus: vi.fn(), beginThinking: vi.fn(), endThinking: vi.fn(), publish: vi.fn(), offerIntent: vi.fn() });
  runtime.replaceStream('s'); vi.mocked(summary.interrupt).mockClear();
  const send = (sequence = 1) => runtime.receive({ type: 'send', text: 'вопрос', sequence, streamId: 's', conversationId: runtime.getPresentation().conversationId });
  return { summary, runtime, send, getStatus, generateResponse, recall, recalled };
}
it('interrupts summary synchronously, captures before recall and excludes covered sources from chat episodes', async () => {
  const f = fixture(); expect(f.send().status).toBe('accepted'); expect(f.summary.interrupt).toHaveBeenCalledTimes(1);
  expect(f.getStatus).not.toHaveBeenCalled(); await flush();
  expect(f.recall).toHaveBeenCalledWith({ text: 'вопрос', excludedMessageIds: ['covered-user', 'covered-assistant'] }, { generation: 0 });
  expect(f.generateResponse).toHaveBeenCalledWith(expect.objectContaining({ summary: { text: 'summary' }, memoryContext: f.recalled }));
  expect(f.summary.confirm).not.toHaveBeenCalled(); f.runtime.dispose();
});
it('omits stale capture and recalled data when a mutation happens while provider status is pending', async () => {
  const f = fixture(); let resolve!: (status: { kind: 'ready' }) => void;
  f.getStatus.mockImplementationOnce(() => new Promise(yes => { resolve = yes; })); f.send(); await flush();
  vi.mocked(f.summary.isCurrent).mockReturnValue(false); resolve({ kind: 'ready' }); await flush();
  const request = f.generateResponse.mock.calls[0]?.[0]; expect(request).not.toHaveProperty('summary'); expect(request?.memoryContext).toEqual(emptyMemoryContext()); f.runtime.dispose();
});
it('retains normal recall when no summary matches and never generates on chat', async () => {
  const f = fixture(); vi.mocked(f.summary.capture).mockResolvedValue(undefined); f.send(); await flush();
  expect(f.generateResponse.mock.calls[0]?.[0]).not.toHaveProperty('summary'); expect(f.generateResponse.mock.calls[0]?.[0].memoryContext).toEqual(f.recalled);
  expect(f.summary.confirm).not.toHaveBeenCalled(); f.runtime.dispose();
});
it.each(['replace', 'detach', 'reset'] as const)('interrupts %s without deleting durable summary cache', action => {
  const f = fixture(); if (action === 'replace') f.runtime.replaceStream('other'); else if (action === 'detach') f.runtime.detachStream(); else f.runtime.receive({ type: 'reset', sequence: 1, streamId: 's', conversationId: f.runtime.getPresentation().conversationId });
  expect(f.summary.interrupt).toHaveBeenCalledTimes(1); expect(f.summary.reset).not.toHaveBeenCalled(); expect(f.summary.deleteSummary).not.toHaveBeenCalled(); f.runtime.dispose();
});

it('restores normal recall without covered IDs when the final provider envelope cannot include summary', async () => {
  const fits = vi.fn(() => false), f = fixture(fits);
  const restored = { ...f.recalled, episodes: [{ kind: 'dialogue' as const, userText: 'covered source', assistantText: 'source reply', occurredAt: '2026-10-17T00:00:00.000Z' }] };
  f.recall.mockResolvedValueOnce({ ok: true, value: f.recalled }).mockResolvedValueOnce({ ok: true, value: restored });
  f.send(); await flush();
  expect(fits).toHaveBeenCalledWith(expect.objectContaining({ summary: { text: 'summary' }, memoryContext: f.recalled }));
  expect(f.recall).toHaveBeenNthCalledWith(2, { text: 'вопрос', excludedMessageIds: [] }, { generation: 0 });
  expect(f.generateResponse.mock.calls[0]?.[0]).not.toHaveProperty('summary');
  expect(f.generateResponse.mock.calls[0]?.[0].memoryContext).toEqual(restored);
  f.recall.mockClear(); f.send(2); await flush();
  const exclusions = f.recall.mock.calls[1]?.[0].excludedMessageIds;
  expect(exclusions).toHaveLength(2); expect(exclusions).not.toContain('covered-user'); expect(exclusions).not.toContain('covered-assistant');
  expect(f.summary.confirm).not.toHaveBeenCalled(); f.runtime.dispose();
});
it.each(['reset', 'dispose'] as const)('does not dispatch a late ordinary recall after summary byte rejection and %s', async action => {
  const f = fixture(() => false); let resolve!: (value: MemoryResult<AIProviderMemoryContext>) => void;
  f.recall.mockResolvedValueOnce({ ok: true, value: f.recalled }).mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
  f.send(); await flush(); expect(f.recall).toHaveBeenCalledTimes(2); expect(f.generateResponse).not.toHaveBeenCalled();
  if (action === 'reset') f.runtime.clearMemoryContext(); else f.runtime.dispose();
  resolve({ ok: true, value: f.recalled }); await flush(); expect(f.generateResponse).not.toHaveBeenCalled(); f.runtime.dispose();
});
it('does not send stale memory or summary if invalidated during the replacement recall', async () => {
  const f = fixture(() => false); let resolve!: (value: MemoryResult<AIProviderMemoryContext>) => void;
  f.recall.mockResolvedValueOnce({ ok: true, value: f.recalled }).mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
  f.send(); await flush(); vi.mocked(f.summary.isCurrent).mockReturnValue(false);
  resolve({ ok: true, value: f.recalled }); await flush();
  expect(f.generateResponse.mock.calls[0]?.[0]).not.toHaveProperty('summary'); expect(f.generateResponse.mock.calls[0]?.[0].memoryContext).toEqual(emptyMemoryContext()); f.runtime.dispose();
});
it('continues chat with empty memory after failed replacement recall', async () => {
  const f = fixture(() => false);
  f.recall.mockResolvedValueOnce({ ok: true, value: f.recalled }).mockResolvedValueOnce({ ok: false, code: 'unavailable' });
  f.send(); await flush(); expect(f.generateResponse.mock.calls[0]?.[0].memoryContext).toEqual(emptyMemoryContext()); expect(f.generateResponse.mock.calls[0]?.[0]).not.toHaveProperty('summary'); f.runtime.dispose();
});

it('omits an overlapping cached summary after six turns while preserving the entire recent suffix', async () => {
  const f = fixture();
  vi.mocked(f.summary.capture).mockResolvedValue(undefined);
  for (let sequence = 1; sequence <= 6; sequence++) { f.send(sequence); await flush(); }
  const first = f.generateResponse.mock.calls[0]![0];
  vi.mocked(f.summary.capture).mockResolvedValue({ text: 'summary', excludedMessageIds: [first.userMessage.id], generation: 1 });
  f.send(7); await flush();
  const request = f.generateResponse.mock.calls[6]![0];
  expect(request.recentContext).toHaveLength(12);
  expect(request.recentContext[0]?.text).toBe(first.userMessage.text);
  expect(request).not.toHaveProperty('summary');
  expect(f.recall.mock.calls.at(-1)?.[0].excludedMessageIds).toHaveLength(12);
  f.runtime.dispose();
});

it('uses hydrated local source identities for coverage and forgets them after reset', async () => {
  const f = fixture(undefined, true);
  f.runtime.hydrateInitialContext([{ role: 'user', text: 'saved topic', createdAt: '', sourceMessageId: 'covered-user' }, { role: 'wisp', text: 'saved answer', createdAt: '', sourceMessageId: 'covered-assistant' }]);
  f.send(); await flush();
  expect(f.generateResponse.mock.calls[0]?.[0]).not.toHaveProperty('summary');
  expect(f.recall.mock.calls[0]?.[0].excludedMessageIds).toEqual(['covered-user', 'covered-assistant']);
  f.runtime.clearMemoryContext(); f.send(2); await flush();
  expect(f.generateResponse.mock.calls[1]?.[0]).toHaveProperty('summary');
  expect(f.generateResponse.mock.calls[1]?.[0].recentContext).toEqual([]);
  f.runtime.dispose();
});
