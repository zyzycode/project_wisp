import { afterEach, expect, it, vi } from 'vitest';
import { crossDayGameObservation } from '../../src/domain/character/cross-day-game-observation';
import { LifeReflectionRuntime } from '../../src/application/services/life-reflection-runtime';
import type { CausalLifeEpisode } from '../../src/application/ports/causal-life.interface';
import type { LifeHistoryWindow } from '../../src/application/ports/life-history.interface';

const games = (): CausalLifeEpisode[] => Array.from({ length: 6 }, (_, i) => ({ appRunId: 'app', sequence: i + 1, revision: 1,
  occurredAt: `2026-11-0${3 + Math.floor(i / 2)}T00:00:00.000Z`, activity: 'cursor_game', activityRunId: `run${i}`, outcome: 'completed', cause: 'completed', terminalReason: null,
  source: 'autonomy', participation: 'user_engaged', triggerSequence: null, executedMs: 1000 }));
const observation = (events = games()) => crossDayGameObservation(events, '2026-10-23', '2026-11-05');
afterEach(() => vi.useRealTimers());
it('requires sufficient dates, ratio, recent completion and fewer than two interruptions in the last four', () => {
  expect(observation()).toMatchObject({ completedCount: 6, interruptedCount: 0, completedUtcDays: 3 });
  expect(observation(games().slice(1))).toBeUndefined();
  expect(observation(games().map(e => ({ ...e, occurredAt: '2026-11-05T00:00:00.000Z' })))).toBeUndefined();
  const interrupted: CausalLifeEpisode = { ...games()[5]!, sequence: 8, cause: 'user_interrupted', source: 'user', outcome: 'cancelled', terminalReason: 'user_interaction', triggerSequence: 7 };
  expect(observation([...games(), interrupted])).toBeUndefined();
  expect(observation([...games().slice(0, -1), interrupted, { ...interrupted, sequence: 9 }, games()[5]!])).toBeUndefined();
  expect(observation([...games().slice(0, -1), { ...interrupted, executedMs: 999 }, games()[5]!])?.interruptedCount).toBe(0);
});
function fixture() {
  vi.useFakeTimers(); let revision = 0, pending = false, generation = 0, now = '2026-11-05T12:00:00.000Z';
  let settle = () => {}; let settled: Promise<void> = Promise.resolve();
  const readWindow = vi.fn(async (): Promise<{ ok: true; value: LifeHistoryWindow }> => ({ ok: true, value: { coverage: 'complete', events: games(), examined: 6, fetched: 6 } }));
  const runtime = new LifeReflectionRuntime({ reader: { readWindow }, barrier: { snapshot: () => ({ revision, pending, generation }), whenSettled: () => settled },
    context: () => ({ generation }), timestamp: () => now, scheduler: { setTimeout, clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) } });
  return { runtime, readWindow, append: () => { revision++; pending = true; settled = new Promise(resolve => { settle = resolve; }); }, settle: () => { pending = false; settle(); }, mutation: () => { generation++; runtime.invalidate(); }, clock: (value: string) => { now = value; } };
}
it('has no startup read, waits once for append acknowledgement and rejects stale source/date/generation captures', async () => {
  const f = fixture(); expect(f.readWindow).not.toHaveBeenCalled();
  expect(await f.runtime.capture('I interrupted your game')).toBeUndefined();
  f.append(); const pending = f.runtime.capture('our game'); await Promise.resolve(); expect(f.readWindow).not.toHaveBeenCalled(); f.settle();
  const capture = await pending; expect(capture?.sources).toHaveLength(6); expect(f.runtime.isCurrent(capture!)).toBe(true);
  expect(await f.runtime.capture('our game')).toBe(capture); expect(f.readWindow).toHaveBeenCalledOnce();
  f.append(); expect(f.runtime.isCurrent(capture!)).toBe(false); f.settle();
  const next = await f.runtime.capture('our game'); expect(next).toBeDefined(); f.clock('2026-11-06T00:00:00.000Z'); expect(f.runtime.isCurrent(next!)).toBe(false);
  const day = await f.runtime.capture('our game'); f.mutation(); expect(f.runtime.isCurrent(day!)).toBe(false);
});
it('retains one unsettled slot after 200ms and never queues another read or returns a late capture', async () => {
  const f = fixture(); f.append(); const pending = f.runtime.capture('our game'); await vi.advanceTimersByTimeAsync(200); expect(await pending).toBeUndefined();
  expect(await f.runtime.capture('our game')).toBeUndefined(); f.settle(); for (let i = 0; i < 8; i++) await Promise.resolve(); expect(f.readWindow).not.toHaveBeenCalled();
  const capture = await f.runtime.capture('our game'); expect(capture).toBeDefined(); f.clock('2026-11-05T11:00:00.000Z'); expect(f.runtime.isCurrent(capture!)).toBe(false);
});
