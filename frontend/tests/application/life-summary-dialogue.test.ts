import type { ILocalMemoryRecall } from '../../src/application/ports/memory-knowledge.interface';
import { afterEach, expect, it, vi } from 'vitest';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { emptyMemoryContext } from '../../src/application/services/memory-recall';
import type { SummaryCapture, ISummaryRuntime } from '../../src/application/ports/summary';
import type { AIProviderRequest, AIProviderResponse } from '../../src/application/ports/ai-provider.interface';
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(0); let id = 0, current = true; const requests: AIProviderRequest[] = [];
  let reply = (_value: AIProviderResponse) => {};
  const capture: SummaryCapture = { text: 'Four recorded games completed.', generation: 0, memoryGeneration: 0, excludedMessageIds: [], life: { fromDateUTC: '2026-10-23', throughDateUTC: '2026-11-05', eventCount: 4, sources: Array.from({ length: 4 }, (_, i) => ({ appRunId: 'app', sequence: i+1, revision: 1 })), gameRuns: Array.from({ length: 4 }, (_, i) => ({ appRunId: 'app', activityRunId: `run${i}` })) } };
  const summary: ISummaryRuntime = { capture: async () => capture, isCurrent: () => current, preview: vi.fn(), confirm: vi.fn(), deleteSummary: vi.fn(), interrupt: vi.fn(), invalidate: vi.fn(), reset: vi.fn(), dispose: vi.fn() };
  const completed = vi.fn(), recall = vi.fn<ILocalMemoryRecall['recall']>(async () => ({ ok: true as const, value: emptyMemoryContext() }));
  const character = new CharacterStateService({ now: Date.now });
  const runtime = new DialogueRuntime({ summary, provider: { getStatus: async () => ({ kind: 'ready' }), canIncludeSummary: () => true, canIncludeLifeReflection: () => true, generateResponse: request => { requests.push(request); return new Promise(resolve => { reply = resolve; }); } }, memory: { generation: () => 0, completed, recall: { recall }, lifeReflection: { capture: async () => ({ memoryGeneration: 0, sourceRevision: 1, asOf: '2026-11-05T12:00:00.000Z', sources: [], observation: { kind: 'shared_game_completions', fromDateUTC: '2026-10-23', throughDateUTC: '2026-11-05', completedCount: 6, interruptedCount: 0, completedUtcDays: 3 } }), isCurrent: () => true, invalidate: vi.fn(), dispose: vi.fn() } }, getSemanticSleepState: () => 'awake', now: Date.now, timestamp: () => '2026-11-05T12:00:00.000Z', createId: () => `id${++id}`, scheduler: { setTimeout, clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) }, getCharacterSnapshot: () => character.getSnapshot(), applyStimulus: vi.fn(), offerIntent: vi.fn(), beginThinking: vi.fn(), endThinking: vi.fn(), transaction: f => f(), publish: vi.fn() });
  runtime.replaceStream('stream');
  return { runtime, requests, completed, recall, capture, stale: () => { current = false; }, send: () => runtime.receive({ type: 'send', streamId: 'stream', conversationId: runtime.getPresentation().conversationId, sequence: 1, text: 'our games' }), respond: () => reply({ requestId: requests[0]!.requestId, status: 'ok', confidence: 1, reply: { text: 'Recorded games' } }) };
}
afterEach(() => vi.useRealTimers());
it('suppresses reflection, excludes exact and equivalent legacy sources, and persists actual-dispatch life_summary use', async () => {
  const f = fixture(); f.send(); await flush(); expect(f.requests[0]).toMatchObject({ summary: { sourceKind: 'life_events', eventCount: 4 } }); expect(f.requests[0]).not.toHaveProperty('lifeReflection');
  expect(f.recall.mock.calls[0]?.[0]).toMatchObject({ excludedCausalSources: f.capture.life!.sources, excludedGameRuns: f.capture.life!.gameRuns });
  f.respond(); await flush(); expect(f.completed.mock.calls[0]?.[0]).toMatchObject({ lifeDerivedUse: { origin: 'life_summary', requestId: f.requests[0]!.requestId, userMessageId: f.requests[0]!.userMessage.id } });
  expect(f.runtime.confirmableSource({ userMessageId: f.requests[0]!.userMessage.id, assistantMessageId: 'any' }, f.runtime.getPresentation().conversationId)).toBeNull(); f.runtime.dispose();
});
it('retires a late consumer result after the frozen proof is invalidated and still attributes provider fallback', async () => {
  const f = fixture(); f.send(); await flush(); f.stale(); f.respond(); await flush(); expect(f.completed).not.toHaveBeenCalled(); expect(f.runtime.getPresentation().turn.phase).toBe('idle'); f.runtime.dispose();
  const fallback = fixture(); fallback.send(); await flush(); await vi.advanceTimersByTimeAsync(30000); expect(fallback.completed.mock.calls[0]?.[0]).toMatchObject({ lifeDerivedUse: { origin: 'life_summary' }, memoryConfirmable: false }); fallback.runtime.dispose();
});
