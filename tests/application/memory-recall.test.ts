import { afterEach, expect, it, vi } from 'vitest';
import { LocalMemoryRecall } from '../../src/application/services/memory-recall';
import type { GameEpisode, MemoryResult, PersistedChatMessage, UserFact } from '../../src/application/ports/memory-repository.interface';
const date = '2026-09-18T00:00:00.000Z';
const pair = (id: string, text: string, reply = 'Ответ'): PersistedChatMessage[] => [
  { id, conversationSessionId: 's', role: 'user', content: text, createdAt: date },
  { id: id + 'a', conversationSessionId: 's', role: 'assistant', content: reply, createdAt: date },
];
function fixture(messages: PersistedChatMessage[] = [], facts: UserFact[] = [], games: GameEpisode[] = [], beforeRead?: () => Promise<void>) {
  let current = true;
  const getRecent = vi.fn(async (): Promise<MemoryResult<readonly PersistedChatMessage[]>> => ({ ok: true, value: messages }));
  const list = vi.fn(async (): Promise<MemoryResult<readonly UserFact[]>> => ({ ok: true, value: facts }));
  const gameRead = vi.fn(async (): Promise<MemoryResult<readonly GameEpisode[]>> => ({ ok: true, value: games }));
  const failure = vi.fn();
  const recall = new LocalMemoryRecall({ beforeRead, history: { getRecent, appendTurn: vi.fn(), closeSession: vi.fn(), closeUnfinishedSessions: vi.fn() }, facts: { list, upsert: vi.fn(), removeByKey: vi.fn() }, gameReader: { getRecent: gameRead }, scheduler: { setTimeout, clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) }, isCurrent: () => current, preference: () => ({ value: 12, confidence: .5, samples: 6 }), onFailure: failure });
  return { recall, getRecent, list, gameRead, failure, stop: () => { current = false; } };
}
afterEach(() => vi.useRealTimers());
it('ranks unique tokens then latest insertion, excludes old facts/temporary roles and volatile source IDs', async () => {
  const f = fixture([...pair('old', 'космос ракета', 'Старое'), ...pair('name', 'Меня зовут Космос'), ...pair('role', 'Сегодня будь космос'), ...pair('forget', 'Забудь космос'), ...pair('new', 'космос ракета', 'Новое'), ...pair('volatile', 'космос ракета космос')]);
  const result = await f.recall.recall({ text: 'космос космос ракета', excludedMessageIds: ['volatile'] }, { generation: 0 });
  expect(result).toMatchObject({ ok: true, value: { episodes: [{ userText: 'космос ракета', assistantText: 'Новое' }, { userText: 'космос ракета', assistantText: 'Старое' }], characterPreferences: [{ confidence: .5 }] } });
  expect(f.getRecent).toHaveBeenCalledWith(100, { generation: 0 }); expect(f.gameRead).toHaveBeenCalledWith(20, { generation: 0 }); expect(f.list).toHaveBeenCalledWith(100, { generation: 0 });
});
it('reserves one place for an actual game without inferring user enjoyment and clips surrogate pairs safely', async () => {
  const f = fixture(pair('u', 'игра космос', 'а'.repeat(399) + '😀'), [], [{ appRunId: 'app', activityRunId: 'g', kind: 'cursor_game', outcome: 'missed', playCompleted: true, executedMs: 523, endedAt: date }]);
  expect(await f.recall.recall({ text: 'помнишь игру и космос', excludedMessageIds: [] }, { generation: 0 })).toMatchObject({ ok: true, value: { episodes: [
    { kind: 'cursor_game', outcome: 'missed', executedMs: 523, occurredAt: date }, { kind: 'dialogue', assistantText: 'а'.repeat(399) },
  ] } });
});
it('times out the whole read group at200ms, does not enqueue another group, and ignores late results', async () => {
  vi.useFakeTimers(); const f = fixture(); let settle!: (value: MemoryResult<readonly PersistedChatMessage[]>) => void;
  f.getRecent.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
  const query = { text: 'игра', excludedMessageIds: [] };
  const pending = f.recall.recall(query, { generation: 0 }); await vi.advanceTimersByTimeAsync(200);
  expect(await pending).toEqual({ ok: false, code: 'busy' });
  expect(await f.recall.recall(query, { generation: 0 })).toEqual({ ok: false, code: 'busy' }); expect(f.getRecent).toHaveBeenCalledTimes(1);
  settle({ ok: true, value: pair('late', 'игра') }); await Promise.resolve(); await Promise.resolve();
});
it('does not report stale read failures or return memory after reset/dispose', async () => {
  const f = fixture(); let settle!: (value: MemoryResult<readonly PersistedChatMessage[]>) => void;
  f.getRecent.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
  const pending = f.recall.recall({ text: 'игра', excludedMessageIds: [] }, { generation: 0 }); await Promise.resolve(); f.stop(); settle({ ok: false, code: 'io_error' });
  expect(await pending).toEqual({ ok: false, code: 'stale' }); expect(f.failure).not.toHaveBeenCalled();
});
it('fails the entire projection if any source fails; never mixes a partial fact set with episodes', async () => {
  const f = fixture(pair('u', 'игра')); f.list.mockResolvedValue({ ok: false, code: 'io_error' });
  expect(await f.recall.recall({ text: 'игра', excludedMessageIds: [] }, { generation: 0 })).toEqual({ ok: false, code: 'io_error' });
});

it('omits a storage-valid game above the wire duration cap without clamping or substituting an older game', async () => {
  const episode = { appRunId: 'app', kind: 'cursor_game' as const, outcome: 'caught' as const, playCompleted: true as const, endedAt: date };
  const f = fixture([...pair('old', 'игра', 'Старая'), ...pair('new', 'игра', 'Новая')], [], [
    { ...episode, activityRunId: 'latest', executedMs: 60001 }, { ...episode, activityRunId: 'older', executedMs: 100 },
  ]);
  expect(await f.recall.recall({ text: 'игра', excludedMessageIds: [] }, { generation: 0 })).toMatchObject({ ok: true, value: { episodes: [
    { kind: 'dialogue', assistantText: 'Новая' }, { kind: 'dialogue', assistantText: 'Старая' },
  ] } }); expect(f.failure).not.toHaveBeenCalled();
});

it('waits for the previous fact correction before issuing reads, within the same deadline', async () => {
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  const f = fixture([], [], [], () => barrier);
  const pending = f.recall.recall({ text: 'имя', excludedMessageIds: [] }, { generation: 0 });
  await Promise.resolve(); expect(f.list).not.toHaveBeenCalled(); release(); await pending; expect(f.list).toHaveBeenCalledTimes(1);
});
it('does not enqueue reads if the preceding-write barrier settles after reset', async () => {
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  const f = fixture([], [], [], () => barrier);
  const pending = f.recall.recall({ text: 'имя', excludedMessageIds: [] }, { generation: 0 }); f.stop(); release();
  expect(await pending).toEqual({ ok: false, code: 'stale' }); expect(f.list).not.toHaveBeenCalled();
});

it('does not issue a late SQL group after the write barrier exhausts the200ms budget', async () => {
  vi.useFakeTimers(); let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  const f = fixture([], [], [], () => barrier);
  const pending = f.recall.recall({ text: 'имя', excludedMessageIds: [] }, { generation: 0 });
  await vi.advanceTimersByTimeAsync(200); expect(await pending).toEqual({ ok: false, code: 'busy' });
  release(); await Promise.resolve(); await Promise.resolve(); expect(f.list).not.toHaveBeenCalled();
});

it('uses the current saved favorite topic for a social event without a second storage read', async () => {
  const f = fixture(pair('u', 'космос'), [{ id: 'fact', factKey: 'user.favorite_topic', factValue: 'космос', confidence: 1, sourceMessageId: 'source', createdAt: date, updatedAt: date }]);
  expect(await f.recall.recall({ text: '', useFavoriteTopic: true, excludedMessageIds: [] }, { generation: 0 })).toMatchObject({ ok: true, value: { episodes: [{ userText: 'космос' }] } });
  expect(f.list).toHaveBeenCalledTimes(1); expect(f.getRecent).toHaveBeenCalledTimes(1);
});
