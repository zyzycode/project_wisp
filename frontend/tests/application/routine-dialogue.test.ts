import { afterEach, expect, it, vi } from 'vitest';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { emptyMemoryContext } from '../../src/application/services/memory-recall';
import type { AIProviderRequest, AIProviderResponse } from '../../src/application/ports/ai-provider.interface';
import type { RoutineHypothesisCapture } from '../../src/application/ports/world-context.interface';
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const capture: RoutineHypothesisCapture = { epoch: 1, generation: 0, source: { datasetEpoch: 'e', cohortId: 'c', revision: 1, zoneId: 'UTC', offsetMinutes: 0 }, calendarKey: 'test',
  context: { scope: 'while_wisp_running', validity: 'tentative', windowStartHour: 6, eligibleDays: 14, positiveDays: 14, recentPositiveDays: 7, observedThroughDate: '2026-11-08' } };
function fixture(allowed = true) {
  vi.useFakeTimers(); vi.setSystemTime(0); let id = 0, current = true;
  let settle = (_value: AIProviderResponse) => {};
  const requests: AIProviderRequest[] = [], completed = vi.fn(), cancel = vi.fn(), apply = vi.fn();
  const recall = vi.fn(async () => ({ ok: true as const, value: emptyMemoryContext() }));
  const recallWithRoutine = vi.fn(async () => ({ ok: true as const, value: { memory: emptyMemoryContext(), routine: capture } }));
  const character = new CharacterStateService({ now: Date.now });
  const runtime = new DialogueRuntime({ provider: { supportsRoutineHypothesis: true, getStatus: async () => ({ kind: 'ready' }), canIncludeRoutineHypothesis: () => allowed, cancel,
    generateResponse: request => { requests.push(request); return new Promise(resolve => { settle = resolve; }); } },
    memory: { generation: () => 0, completed, routine: { isCurrent: () => current }, recall: { recall, recallWithRoutine } }, getSemanticSleepState: () => 'awake', now: Date.now,
    timestamp: () => '2026-11-09T07:00:00.000Z', createId: () => `id${++id}`, scheduler: { setTimeout, clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) },
    getCharacterSnapshot: () => character.getSnapshot(), applyStimulus: apply, offerIntent: vi.fn(), beginThinking: vi.fn(), endThinking: vi.fn(), transaction: f => f(), publish: vi.fn() });
  runtime.replaceStream('stream');
  const send = (sequence = 1) => runtime.receive({ type: 'send', streamId: 'stream', conversationId: runtime.getPresentation().conversationId, sequence, text: 'hello' });
  const respond = () => settle({ requestId: requests.at(-1)!.requestId, status: 'ok', confidence: 1, reply: { text: 'Tentative routine answer' } });
  return { runtime, recallWithRoutine, requests, completed, send, respond, cancel, apply, stale: () => { current = false; } };
}
afterEach(() => vi.useRealTimers());
it('binds only an actually dispatched projection and never echoes its pair into the next request', async () => {
  const f = fixture(); f.send(); await flush(); expect(f.requests[0]?.routineHypothesis).toEqual(capture.context); f.respond(); await flush();
  expect(f.completed.mock.calls[0]![0]).toMatchObject({ lifeDerivedUse: { origin: 'routine_hypothesis', requestId: f.requests[0]!.requestId, userMessageId: f.requests[0]!.userMessage.id } });
  f.send(2); await flush(); expect(f.requests[1]?.recentContext).toEqual([]); f.runtime.dispose();
});
it('does not associate or suppress a bundle atomically dropped by transport budget', async () => {
  const f = fixture(false); f.send(); await flush(); expect(f.requests[0]).not.toHaveProperty('routineHypothesis'); f.respond(); await flush(); expect(f.completed.mock.calls[0]![0]).not.toHaveProperty('lifeDerivedUse'); f.runtime.dispose();
});
it('synchronously cancels a withdrawn source and rejects late replies without state/memory effects', async () => {
  const f = fixture(); f.send(); await flush(); f.stale(); f.runtime.invalidateRoutineProjection(); expect(f.cancel).toHaveBeenCalledWith(f.requests[0]!.requestId);
  f.respond(); await flush(); expect(f.completed).not.toHaveBeenCalled(); expect(f.apply).toHaveBeenCalledTimes(1); expect(f.runtime.getPresentation().turn.phase).toBe('idle'); f.runtime.dispose();
});
it('attributes an already-dispatched timed-out turn so its fallback cannot become independent routine evidence', async () => {
  const f = fixture(); f.send(); await flush(); await vi.advanceTimersByTimeAsync(30000);
  expect(f.completed.mock.calls[0]![0]).toMatchObject({ lifeDerivedUse: { origin: 'routine_hypothesis' }, memoryConfirmable: false }); f.runtime.dispose();
});

it('does not cancel an ordinary in-flight chat when its optional routine bundle was omitted', async () => {
  const f = fixture(false); f.send(); await flush(); expect(f.requests[0]).not.toHaveProperty('routineHypothesis');
  f.stale(); f.runtime.invalidateRoutineProjection(); expect(f.cancel).not.toHaveBeenCalled();
  f.respond(); await flush(); expect(f.completed).toHaveBeenCalledOnce(); expect(f.completed.mock.calls[0]![0]).not.toHaveProperty('lifeDerivedUse');
  expect(f.runtime.getPresentation().turn).toMatchObject({phase:'completed',replyText:'Tentative routine answer'});
  f.send(2); await flush(); expect(f.requests[1]!.recentContext).toHaveLength(2); expect(f.requests[1]!.recentContext[1]!.text).toBe('Tentative routine answer'); f.runtime.dispose();
});
