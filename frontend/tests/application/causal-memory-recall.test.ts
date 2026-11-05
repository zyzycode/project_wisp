import { afterEach, expect, it, vi } from 'vitest';
import { LocalMemoryRecall } from '../../src/application/services/memory-recall';
import type { CausalRecallPage } from '../../src/application/ports/causal-recall.interface';
import type { MemoryResult } from '../../src/application/ports/memory-repository.interface';
import type { CausalLifeEpisode } from '../../src/application/ports/causal-life.interface';
const now = '2026-11-05T00:00:00.000Z', then = '2026-11-01T00:00:00.000Z';
const episode: CausalLifeEpisode = { appRunId: 'app', sequence: 2, revision: 1, occurredAt: then, activityRunId: 'run', activity: 'cursor_game', outcome: 'cancelled', terminalReason: 'user_interaction', cause: 'user_interrupted', source: 'user', triggerSequence: 1, executedMs: 1500, participation: 'user_engaged' };
const page: CausalRecallPage = { candidates: [{ source: { appRunId: 'app', sequence: 2, revision: 1 }, episode, match: 'exact_causal_bucket' }], coverage: 'complete', examined: 1, fetched: 1 };
function fixture() {
  let current = true;
  const causal = vi.fn(async (): Promise<MemoryResult<CausalRecallPage>> => ({ ok: true, value: page }));
  const upsert = vi.fn(), failure = vi.fn();
  const recall = new LocalMemoryRecall({
    facts: { list: async () => ({ ok: true, value: [] }), upsert, removeByKey: vi.fn() },
    history: { getRecent: async () => ({ ok: true, value: [] }), appendTurn: vi.fn(), closeSession: vi.fn(), closeUnfinishedSessions: vi.fn() },
    gameReader: { getRecent: async () => ({ ok: true, value: [{ appRunId: 'app', activityRunId: 'run', kind: 'cursor_game', outcome: 'caught', playCompleted: true, executedMs: 1500, endedAt: then }] }) },
    causalRecall: { find: causal }, timestamp: () => now, preference: () => undefined,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }, isCurrent: () => current, onFailure: failure,
  });
  return { recall, causal, upsert, failure, reset: () => { current = false; } };
}
afterEach(() => vi.useRealTimers());
it('projects only the matched fact and suppresses an equivalent legacy game without learning it again', async () => {
  const f = fixture(); const result = await f.recall.recall({ text: 'помнишь прерванную игру', excludedMessageIds: [] }, { generation: 0 });
  expect(result).toMatchObject({ ok: true, value: { episodes: [{ kind: 'causal_event', cause: 'user_interrupted', outcome: 'cancelled', actor: 'user', executedMs: 1500 }] } });
  expect(f.causal).toHaveBeenCalledWith({ key: 'game.user_interrupted', before: now }, { generation: 0 });
  expect(JSON.stringify(result)).not.toContain('appRunId'); expect(JSON.stringify(result)).not.toContain('activityRunId'); expect(f.upsert).not.toHaveBeenCalled();
});
it('does not query ambiguous, negated or unknown situations and uses exact source exclusion for a trusted situation', async () => {
  const f = fixture();
  await f.recall.recall({ text: 'я не прерывал игру', excludedMessageIds: [] }, { generation: 0 }); expect(f.causal).not.toHaveBeenCalled();
  await f.recall.recall({ text: 'игра', excludedMessageIds: [], causalSituation: { source: page.candidates[0]!.source, episode } }, { generation: 0 });
  expect(f.causal).toHaveBeenLastCalledWith({ key: 'game.user_interrupted', before: now, exclude: page.candidates[0]!.source }, { generation: 0 });
  f.causal.mockClear();
  await f.recall.recall({ text: 'игра', excludedMessageIds: [], causalSituation: { source: page.candidates[0]!.source, episode: { ...episode, cause: 'unknown' } } }, { generation: 0 });
  expect(f.causal).not.toHaveBeenCalled();
});
it('times out one causal group, refuses another while pending and discards its late source result', async () => {
  vi.useFakeTimers(); const f = fixture(); let settle!: (value: MemoryResult<CausalRecallPage>) => void;
  f.causal.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
  const query = { text: 'игра прервана', excludedMessageIds: [] };
  const pending = f.recall.recall(query, { generation: 0 }); await vi.advanceTimersByTimeAsync(200);
  expect(await pending).toEqual({ ok: false, code: 'busy' }); expect(await f.recall.recall(query, { generation: 0 })).toEqual({ ok: false, code: 'busy' });
  expect(f.causal).toHaveBeenCalledTimes(1); settle({ ok: true, value: page }); await vi.advanceTimersByTimeAsync(0); expect(f.upsert).not.toHaveBeenCalled();
});
it('invalidates pending source reads on mutation/reset and safely omits failed storage', async () => {
  const f = fixture(); let settle!: (value: MemoryResult<CausalRecallPage>) => void;
  f.causal.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
  const pending = f.recall.recall({ text: 'прерванная игра', excludedMessageIds: [] }, { generation: 0 });
  await vi.waitFor(() => expect(f.causal).toHaveBeenCalledTimes(1)); f.reset(); settle({ ok: true, value: page });
  expect(await pending).toEqual({ ok: false, code: 'stale' }); expect(f.failure).not.toHaveBeenCalled();
  const broken = fixture(); broken.causal.mockResolvedValue({ ok: false, code: 'unavailable' });
  expect(await broken.recall.recall({ text: 'игра', excludedMessageIds: [] }, { generation: 0 })).toEqual({ ok: false, code: 'unavailable' });
});
