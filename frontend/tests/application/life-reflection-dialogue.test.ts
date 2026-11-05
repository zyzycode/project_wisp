import { afterEach, expect, it, vi } from 'vitest';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import type { AIProviderRequest, AIProviderResponse } from '../../src/application/ports/ai-provider.interface';
import type { LifeReflectionCapture } from '../../src/application/ports/life-history.interface';
import { emptyMemoryContext } from '../../src/application/services/memory-recall';
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const capture: LifeReflectionCapture = { memoryGeneration: 0, sourceRevision: 1, asOf: '2026-11-05T12:00:00.000Z', sources: [], observation: { kind: 'shared_game_completions', fromDateUTC: '2026-10-23', throughDateUTC: '2026-11-05', completedCount: 6, interruptedCount: 0, completedUtcDays: 3 } };
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(0); let id = 0, current = true;
  let settle = (_value: AIProviderResponse) => {};
  const requests: AIProviderRequest[] = [], completed = vi.fn();
  const reflection = { capture: vi.fn(async () => capture), isCurrent: () => current, invalidate: vi.fn(), dispose: vi.fn() };
  const recall = vi.fn(async () => ({ ok: true as const, value: emptyMemoryContext() }));
  const character = new CharacterStateService({ now: Date.now });
  const runtime = new DialogueRuntime({ provider: { getStatus: async () => ({ kind: 'ready' }), canIncludeLifeReflection: () => true,
    generateResponse: request => { requests.push(request); return new Promise(resolve => { settle = resolve; }); } },
    memory: { generation: () => 0, completed, lifeReflection: reflection, recall: { recall } }, getSemanticSleepState: () => 'awake', now: Date.now,
    timestamp: () => '2026-11-05T12:00:00.000Z', createId: () => `id${++id}`, scheduler: { setTimeout, clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) },
    getCharacterSnapshot: () => character.getSnapshot(), applyStimulus: vi.fn(), offerIntent: vi.fn(), beginThinking: vi.fn(), endThinking: vi.fn(), transaction: f => f(), publish: vi.fn() });
  runtime.replaceStream('stream');
  const send = () => runtime.receive({ type: 'send', streamId: 'stream', conversationId: runtime.getPresentation().conversationId, sequence: 1, text: 'our game' });
  const respond = () => settle({ requestId: requests[0]!.requestId, status: 'ok', confidence: 1, reply: { text: 'Tentative reflection' } });
  return { runtime, reflection, recall, requests, completed, send, respond, stale: () => { current = false; } };
}
afterEach(() => vi.useRealTimers());
it('shares admission with recall and attributes actual dispatch even when provider times out to fallback', async () => {
  const f = fixture(); f.send(); await flush(); expect(f.requests[0]?.lifeReflection).toEqual(capture.observation);
  await vi.advanceTimersByTimeAsync(30000); expect(f.completed).toHaveBeenCalledOnce();
  expect(f.completed.mock.calls[0]![0]).toMatchObject({ lifeDerivedUse: { origin: 'reflection', requestId: f.requests[0]!.requestId, userMessageId: f.requests[0]!.userMessage.id } }); f.runtime.dispose();
});
it('discards the entire late derived response on source revision change', async () => {
  const f = fixture(); f.send(); await flush(); f.stale(); f.respond(); await flush();
  expect(f.completed).not.toHaveBeenCalled(); expect(f.runtime.getPresentation().turn.phase).toBe('idle'); f.runtime.dispose();
});
it('uses one 200ms group for a slow proof and does not await a second reflection budget after recall', async () => {
  const f = fixture(); let release = (_value: LifeReflectionCapture) => {};
  f.reflection.capture.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  f.send(); await flush(); expect(f.recall).toHaveBeenCalledOnce(); expect(f.requests).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(200); expect(f.requests).toHaveLength(1); expect(f.requests[0]).not.toHaveProperty('lifeReflection');
  release(capture); await flush(); f.respond(); await flush(); expect(f.completed.mock.calls[0]![0]).not.toHaveProperty('lifeDerivedUse'); f.runtime.dispose();
});
