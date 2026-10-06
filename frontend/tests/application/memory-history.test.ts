import { describe, expect, it, vi } from 'vitest';
import { MemoryHistory } from '../../src/application/services/memory-history';
import { boundMemoryContext } from '../../src/application/services/memory-context';
import type { MemoryOperationContext, MemoryResult, IChatHistoryRepository } from '../../src/application/ports/memory-repository.interface';
const now = '2026-09-18T00:00:00.000Z';
function fixture(gameObserver?: import('../../src/application/ports/ai-event-provider.interface').IGameEpisodeCommitObserver) {
  let id = 0; let context: MemoryOperationContext | null = { generation: 0 };
  const appendTurn = vi.fn<IChatHistoryRepository['appendTurn']>(async () => ({ ok: true, value: undefined } as const));
  const append = vi.fn(async () => ({ ok: true, value: undefined } as const));
  const getRecent = vi.fn(async () => ({ ok: true, value: [{ id: 'old', role: 'assistant' as const, conversationSessionId: 'old-session', content: 'Помню тебя', createdAt: now }] } as const));
  const failure = vi.fn();
  const history = new MemoryHistory({ gameObserver, history: { appendTurn, getRecent, closeSession: vi.fn(async () => ({ ok: true, value: undefined } as const)), closeUnfinishedSessions: vi.fn(async () => ({ ok: true, value: undefined } as const)) }, episodes: { append }, context: () => context, createId: () => `id-${++id}`, toTimestamp: ms => new Date(Date.parse(now) + ms).toISOString(), onFailure: failure });
  return { history, appendTurn, append, getRecent, failure, setContext: (c: MemoryOperationContext | null) => { context = c; } };
}
const turn = { user: { id: 'user', text: 'Привет', createdAt: now }, assistant: { id: 'assistant', text: 'Привет!', createdAt: now }, memoryGeneration: 0 };
it('maps persistent context once without modifying stored messages', async () => {
  const f = fixture(); expect(await f.history.hydrate()).toEqual([{ role: 'wisp', text: 'Помню тебя', createdAt: now }]); expect(f.getRecent).toHaveBeenCalledWith(20, { generation: 0 });
});
it('uses one lazy app session for completed pairs, rotates it only on full memory reset', async () => {
  const f = fixture(); await f.history.completed(turn); await f.history.completed({ ...turn, user: { ...turn.user, id: 'next' } });
  const calls = f.appendTurn.mock.calls as readonly (readonly unknown[])[];
  expect(calls[0]?.[0]).toMatchObject({ session: { appRunId: 'id-1', id: 'id-2', startedAt: now }, user: { role: 'user' }, assistant: { role: 'assistant' } });
  expect(calls[1]?.[0]).toMatchObject({ session: { id: 'id-2' } });
  f.history.reset(); f.setContext({ generation: 1 }); await f.history.completed({ ...turn, memoryGeneration: 1 });
  expect(f.appendTurn).toHaveBeenLastCalledWith(expect.objectContaining({ session: expect.objectContaining({ appRunId: 'id-3' }) }), { generation: 1 });
});
it('records only real play-completed terminals with injected monotonic-to-UTC mapping', async () => {
  const f = fixture(); const result = { activityRunId: 'game', atMs: 1000, outcome: 'cancelled' as const, playCompleted: false, executedMs: 500 };
  await f.history.game(result, 0); expect(f.append).not.toHaveBeenCalled();
  await f.history.game({ ...result, playCompleted: true }, 0);
  expect(f.append).toHaveBeenCalledWith({ appRunId: 'id-1', activityRunId: 'game', kind: 'cursor_game', outcome: 'cancelled', playCompleted: true, executedMs: 500, endedAt: '2026-09-18T00:00:01.000Z' }, { generation: 0 });
});
it('drops old callbacks before writes and ignores old operation failures after reset', async () => {
  const f = fixture(); let resolve!: (r: MemoryResult<void>) => void;
  f.appendTurn.mockImplementationOnce(() => new Promise<MemoryResult<void>>(resolvePromise => { resolve = resolvePromise; }));
  const writing = f.history.completed(turn); await Promise.resolve(); f.setContext({ generation: 1 });
  resolve({ ok: false, code: 'io_error' }); await writing; expect(f.failure).not.toHaveBeenCalled();
  await f.history.completed(turn); expect(f.appendTurn).toHaveBeenCalledTimes(1);
});
it('uses bounded volatile fallback after read failure and never queues it for replay', async () => {
  const f = fixture(); f.getRecent.mockRejectedValueOnce(new Error('private path'));
  expect(await f.history.hydrate()).toEqual([]); expect(f.failure).toHaveBeenCalledWith('unavailable');
  f.setContext(null); await f.history.completed(turn); expect(f.appendTurn).not.toHaveBeenCalled();
});
describe('bounded context', () => {
  it('caps message count and total characters while preserving latest chronological order', () => {
    const input = Array.from({ length: 30 }, (_, i) => ({ role: 'wisp' as const, text: `${i}:` + 'x'.repeat(2100), createdAt: now }));
    const result = boundMemoryContext(input); expect(result).toHaveLength(4); expect(result[0]?.text.startsWith('26:')).toBe(true); expect(result.reduce((sum, m) => sum + m.text.length, 0)).toBe(8000); expect(input[0]?.text.length).toBe(2102);
  });
  it('never truncates between a surrogate pair', () => { expect(boundMemoryContext([{ role: 'wisp', text: 'x'.repeat(1999) + '😀', createdAt: now }])[0]?.text).toBe('x'.repeat(1999)); });
});

it('notifies the event observer only after a current acknowledged game write', async () => {
  const committed = vi.fn(), f = fixture({ committed });
  const game = { activityRunId: 'g', atMs: 0, outcome: 'caught' as const, playCompleted: true, executedMs: 2000 };
  let ack!: (value: { ok: true; value: undefined }) => void;
  f.append.mockImplementationOnce(() => new Promise(resolve => { ack = resolve; }));
  const saved = f.history.game(game, 0); expect(committed).not.toHaveBeenCalled();
  ack({ ok: true, value: undefined }); await saved; expect(committed).toHaveBeenCalledTimes(1);
  f.append.mockRejectedValueOnce(new Error('write failed')); await f.history.game({ ...game, activityRunId: 'failure' }, 0); expect(committed).toHaveBeenCalledTimes(1);
  f.append.mockImplementationOnce(() => new Promise(resolve => { ack = resolve; })); const late = f.history.game({ ...game, activityRunId: 'late' }, 0);
  f.setContext({ generation: 1 }); ack({ ok: true, value: undefined }); await late; expect(committed).toHaveBeenCalledTimes(1);
});
