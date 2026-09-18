import { expect, it, vi } from 'vitest';
import { recognizeMemoryFact, parseMemoryCandidates } from '../../src/application/services/memory-fact-registry';
import { MemoryKnowledge } from '../../src/application/services/memory-knowledge';
import { MemoryHistory } from '../../src/application/services/memory-history';
import type { MemoryResult, UserFact } from '../../src/application/ports/memory-repository.interface';

it.each([
  ['Запомни: Меня зовут Аня.', 'user.display_name', 'Аня'], ['Correction: My name is Émile', 'user.display_name', 'Émile'],
  ['Называй меня Анна-Мария', 'user.preferred_address', 'Анна-Мария'], ['Моя любимая тема — Космос 2026', 'user.favorite_topic', 'Космос 2026'],
  ['Я предпочитаю короткие ответы', 'user.reply_style', 'brief'], ['Always give detailed replies.', 'user.reply_style', 'detailed'],
  ['Мне не нравится игра с курсором.', 'user.cursor_game', 'dislike'], ['I like the cursor game', 'user.cursor_game', 'like'],
])('recognizes a complete explicit statement %s', (text, key, value) => { expect(recognizeMemoryFact(text)).toEqual({ key, value }); });
it.each(['Сегодня будь пиратом', 'Отвечай кратко', '"Меня зовут Аня"', 'Он сказал: Меня зовут Аня', 'Меня зовут не Аня', 'My name is Bob if you ask', 'My name is Bob. I like cats', "My favorite topic is 'secrets'", 'Я люблю игру', 'Меня зовут ' + 'а'.repeat(81), 'Remember: Remember: My name is Bob'])('does not turn temporary/quoted/conditional text into facts: %s', text => { expect(recognizeMemoryFact(text)).toBeUndefined(); });
it('drops every duplicate candidate key even if its sibling is malformed; validates the literal source', () => {
  const candidate = { key: 'user.display_name', value: 'Аня', evidenceQuote: 'Меня зовут Аня' };
  expect(parseMemoryCandidates([candidate, { key: candidate.key }], candidate.evidenceQuote)).toEqual([]);
  expect(parseMemoryCandidates([candidate], 'My name is Bob')).toEqual([]);
});
const date = '2026-09-18T00:00:00.000Z';
const turn = { user: { id: 'u', text: 'Мне нравится игра с курсором', createdAt: date }, assistant: { id: 'a', text: 'Хорошо', createdAt: date }, memoryGeneration: 0 };
function fixture() {
  let current = true;
  const upsert = vi.fn(async (fact: UserFact): Promise<MemoryResult<UserFact>> => ({ ok: true, value: fact }));
  const onFailure = vi.fn(), observe = vi.fn();
  const knowledge = new MemoryKnowledge({ facts: { upsert, list: vi.fn(), removeByKey: vi.fn() }, createId: () => 'f', isCurrent: () => current, onFailure, preferenceLearning: { observe } });
  const appendTurn = vi.fn(async (): Promise<MemoryResult<void>> => ({ ok: true, value: undefined }));
  const history = new MemoryHistory({ history: { appendTurn, getRecent: vi.fn(), closeSession: vi.fn(), closeUnfinishedSessions: vi.fn() }, episodes: { append: vi.fn() }, context: () => current ? { generation: 0 } : null, createId: () => 's', toTimestamp: () => date, onFailure,
    onPersisted: (turn, context) => knowledge.persisted(turn, context) });
  return { knowledge, history, upsert, appendTurn, onFailure, observe, stop: () => { current = false; } };
}
it('waits for append acknowledgement, writes without a model candidate, emits verified evidence once', async () => {
  const f = fixture(); let ack!: (value: MemoryResult<void>) => void;
  f.appendTurn.mockImplementationOnce(() => new Promise(resolve => { ack = resolve; }));
  const saving = f.history.completed(turn); await Promise.resolve(); expect(f.upsert).not.toHaveBeenCalled();
  ack({ ok: true, value: undefined }); await saving; await f.history.completed(turn);
  expect(f.upsert).toHaveBeenCalledTimes(1); expect(f.upsert).toHaveBeenCalledWith(expect.objectContaining({ sourceMessageId: 'u', confidence: 1 }), { generation: 0 });
  expect(f.observe).toHaveBeenCalledExactlyOnceWith({ sourceMessageId: 'u', key: 'activity.cursor_game', disposition: 'like' });
});
it('does not extract after a failed append', async () => { const f = fixture(); f.appendTurn.mockResolvedValue({ ok: false, code: 'storage_full' }); await f.history.completed(turn); expect(f.upsert).not.toHaveBeenCalled(); });
it('reports a failed fact write without rejecting completed history or emitting learning', async () => { const f = fixture(); f.upsert.mockResolvedValue({ ok: false, code: 'storage_full' }); await expect(f.history.completed(turn)).resolves.toBeUndefined(); expect(f.onFailure).toHaveBeenCalledWith('storage_full'); expect(f.observe).not.toHaveBeenCalled(); });
it('ignores append ack after reset/dispose', async () => {
  const f = fixture(); let ack!: (value: MemoryResult<void>) => void;
  f.appendTurn.mockImplementationOnce(() => new Promise(resolve => { ack = resolve; }));
  const saving = f.history.completed(turn); await Promise.resolve(); f.stop(); ack({ ok: true, value: undefined }); await saving; expect(f.upsert).not.toHaveBeenCalled();
});
it('ignores fact ack after reset/dispose', async () => {
  const f = fixture(); let ack!: (value: MemoryResult<UserFact>) => void;
  f.upsert.mockImplementationOnce(() => new Promise(resolve => { ack = resolve; }));
  const saving = f.knowledge.persisted(turn, { generation: 0 }); f.stop(); ack({ ok: false, code: 'io_error' }); await saving;
  expect(f.observe).not.toHaveBeenCalled(); expect(f.onFailure).not.toHaveBeenCalled();
});
it('serializes correction writes in source order instead of letting a slower old fact overwrite the new one', async () => {
  const f = fixture(); let ack!: (value: MemoryResult<UserFact>) => void;
  f.upsert.mockImplementationOnce(() => new Promise(resolve => { ack = resolve; }));
  const first = f.history.completed({ ...turn, user: { ...turn.user, text: 'Меня зовут Аня' } });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const second = f.history.completed({ ...turn, user: { ...turn.user, id: 'new', text: 'Исправление: Меня зовут Мария' } });
  await Promise.resolve(); expect(f.appendTurn).toHaveBeenCalledTimes(1);
  const fact = f.upsert.mock.calls[0]![0]; ack({ ok: true, value: fact }); await first; await second;
  expect(f.upsert.mock.calls.map(call => call[0].factValue)).toEqual(['Аня', 'Мария']);
});
