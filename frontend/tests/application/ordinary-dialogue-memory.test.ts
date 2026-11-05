import { afterEach, expect, it, vi } from 'vitest';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { MemoryHistory } from '../../src/application/services/memory-history';
import { MemoryKnowledge } from '../../src/application/services/memory-knowledge';
import type { AIProviderRequest } from '../../src/application/ports/ai-provider.interface';
import type { UserFact } from '../../src/application/ports/memory-repository.interface';
import { parseDialogueCommand } from '../../src/shared/dialogue-ipc-validation';

const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime('2026-11-06T00:00:00.000Z');
  let id = 0;
  const upsert = vi.fn(async (fact: UserFact) => ({ ok: true as const, value: fact }));
  const knowledge = new MemoryKnowledge({ facts: { upsert, list: vi.fn(), removeByKey: vi.fn() },
    isCurrent: () => true, createId: () => `fact-${++id}`, onFailure: vi.fn() });
  const history = new MemoryHistory({ history: { appendTurn: vi.fn(async () => ({ ok: true as const, value: undefined })),
    getRecent: vi.fn(), closeSession: vi.fn(), closeUnfinishedSessions: vi.fn() }, episodes: { append: vi.fn() },
    context: () => ({ generation: 0 }), createId: () => `history-${++id}`, toTimestamp: () => new Date().toISOString(),
    onFailure: vi.fn(), onPersisted: (turn, context) => knowledge.persisted(turn, context) });
  const generateResponse = vi.fn(async (request: AIProviderRequest) => ({ requestId: request.requestId,
    status: 'ok' as const, confidence: 1, reply: { text: 'Продолжим разговор.' } }));
  const runtime = new DialogueRuntime({ getSemanticSleepState: () => 'awake', provider: { getStatus: async () => ({ kind: 'ready' }), generateResponse },
    memory: { generation: () => 0, completed: turn => history.completed(turn) },
    now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `dialogue-${++id}`,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    getCharacterSnapshot: () => new CharacterStateService().getSnapshot(), transaction: commit => commit(),
    applyStimulus: vi.fn(), offerIntent: vi.fn(), publish: vi.fn(), beginThinking: vi.fn(), endThinking: vi.fn() });
  runtime.replaceStream('stream');
  const send = (sequence: number, text: string) => runtime.receive({ type: 'send', streamId: 'stream',
    conversationId: runtime.getPresentation().conversationId, sequence, text });
  return { runtime, send, history, generateResponse, upsert };
}
it('keeps an ordinary conversation about drinks and subsequent explicit name correction in the shared memory flow', async () => {
  const f = fixture();
  expect(f.send(1, 'Я люблю кофе')).toMatchObject({ status: 'accepted' }); await flush();
  expect(f.send(2, 'Исправление: Меня зовут Мария')).toMatchObject({ status: 'accepted' }); await flush();
  await f.history.whenSettled();
  expect(f.upsert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ factKey: 'user.display_name', factValue: 'Мария' }), { generation: 0 });
  const second = f.generateResponse.mock.calls[1]![0];
  expect(second.recentContext).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'user', text: 'Я люблю кофе' })]));
  expect(second).not.toHaveProperty('beveragePreference');
  f.runtime.dispose();
});
it('does not divert a coffee/tea correction from the ordinary dialogue or lose the next conversational reference', async () => {
  const f = fixture();
  f.send(1, 'Нет, предпочитаю чай'); await flush();
  f.send(2, 'Почему ты так думаешь?'); await flush();
  expect(f.generateResponse).toHaveBeenCalledTimes(2);
  expect(f.generateResponse.mock.calls[1]![0].recentContext).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: 'user', text: 'Нет, предпочитаю чай' }),
    expect.objectContaining({ role: 'wisp', text: 'Продолжим разговор.' }),
  ]));
  expect(f.upsert).not.toHaveBeenCalled();
  f.runtime.dispose();
});
it('rejects the retired per-turn request flag at admission', () => {
  expect(() => parseDialogueCommand({ type: 'send', streamId: 'stream', conversationId: 'conversation', sequence: 1,
    text: 'Кофе', requestBeverageProposal: true })).toThrow();
});
