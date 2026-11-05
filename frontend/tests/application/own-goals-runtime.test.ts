import { expect, it, vi } from 'vitest';
import { OwnGoalsRuntime } from '../../src/application/services/own-goals-runtime';
import type { IMotivationRepository, MotivationRecord } from '../../src/application/ports/motivation.interface';
import type { MemoryResult } from '../../src/application/ports/memory-repository.interface';
import { settleOwnGoals } from '../../src/domain/character/own-goals';

const start = Date.parse('2026-11-05T10:00:00.000Z');
function fixture() {
  let now = start, generation = 0, allowed = true, offline = false, needs = { energy: 35, boredom: 65 }, count = 0;
  let state: MotivationRecord | null = null;
  const repository: IMotivationRepository = {
    read: vi.fn<IMotivationRepository['read']>(async suppliedNow => {
      if (state) state = settleOwnGoals(state, suppliedNow);
      return { ok: true, value: state };
    }),
    replace: vi.fn<IMotivationRepository['replace']>(async (value, expected) => {
      if ((state?.revision ?? null) !== expected) return { ok: false, code: 'conflict' };
      state = value; return { ok: true, value: undefined };
    }),
  };
  const onFailure = vi.fn();
  const runtime = new OwnGoalsRuntime({ repository, context: () => offline ? null : ({ generation }), wallNow: () => now,
    getNeeds: () => needs, eligible: () => allowed, createId: kind => `${kind}-${++count}`, onFailure });
  return { runtime, repository, onFailure, get state() { return state; }, setState: (value: MotivationRecord | null) => { state = value; },
    setNow: (ms: number) => { now = start + ms; }, setAllowed: (value: boolean) => { allowed = value; },
    setNeeds: (value: typeof needs) => { needs = value; }, reset: () => { generation++; runtime.invalidate(); state = null; count = 0; },
    nextGeneration: () => { generation++; }, setOffline: (value: boolean) => { offline = value; } };
}
async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
it('only acknowledged goals affect selection, hold one slot per kind, and complete once from a matching actual run', async () => {
  const f = fixture();
  expect(f.runtime.multiplier('sleep')).toBe(1);
  f.runtime.opportunity(); await flush();
  expect(f.state?.goals).toHaveLength(2); expect(f.runtime.multiplier('sleep')).toBe(1.2);
  f.runtime.opportunity(); await flush(); expect(f.state?.goals).toHaveLength(2);
  f.runtime.activityOutcome('preview', 'completed'); await flush();
  expect(f.state?.goals.map(g => g.status)).toEqual(['pending', 'pending']);
  f.runtime.activityStarted('real-rest', 'rest'); f.runtime.activityOutcome('other', 'completed');
  f.runtime.activityOutcome('real-rest', 'completed'); f.runtime.activityOutcome('real-rest', 'completed'); await flush();
  expect(f.state?.goals.map(g => g.status)).toEqual(['completed', 'pending']);
  f.runtime.activityStarted('explore', 'explore'); f.runtime.activityOutcome('explore', 'failed'); await flush();
  expect(f.state?.goals.map(g => g.status)).toEqual(['completed', 'cancelled']);
  expect(f.runtime.multiplier('wander')).toBe(1);
});
it('quiet/sleep/menu gates remove only influence and do not extend goal expiry or restore a route', async () => {
  const f = fixture(); f.runtime.opportunity(); await flush();
  const expiry = f.state?.goals[0]?.expiresAt;
  f.setAllowed(false); expect(f.runtime.multiplier('sleep')).toBe(1);
  f.runtime.opportunity(); await flush(); expect(f.state?.goals[0]?.expiresAt).toBe(expiry);
  f.setAllowed(true); expect(f.runtime.multiplier('sleep')).toBe(1.2);
  f.setNow(600000); expect(f.runtime.multiplier('sleep')).toBe(1);
  f.runtime.opportunity(); await flush(); expect(f.state?.goals.map(g => g.status)).toEqual(['expired', 'expired']);
});
it('cancels an in-flight creation after its ack without recreating the same sustained deficit', async () => {
  const f = fixture(); let acknowledge: ((value: MemoryResult<void>) => void) | undefined;
  const replace = f.repository.replace;
  vi.mocked(f.repository.replace).mockImplementationOnce(async (value, expected, context) => {
    const result = await replace(value, expected, context);
    return new Promise(resolve => { acknowledge = () => resolve(result); });
  });
  f.runtime.opportunity(); await flush(); expect(f.state?.goals).toHaveLength(2);
  const cancelled = f.runtime.cancel(); expect(f.runtime.multiplier('sleep')).toBe(1);
  acknowledge?.({ ok: true, value: undefined }); await cancelled;
  expect(f.state?.goals.map(g => g.status)).toEqual(['cancelled', 'cancelled']);
  f.runtime.opportunity(); await flush(); expect(f.state?.goals.map(g => g.status)).toEqual(['cancelled', 'cancelled']);
});
it('restores only fresh acknowledged state, ignores pre-reset outcomes and never publishes a late disposed read', async () => {
  const f = fixture(); f.runtime.opportunity(); await flush();
  f.runtime.activityStarted('old', 'rest'); f.reset(); f.runtime.activityOutcome('old', 'completed');
  await f.runtime.restore(); expect(f.state).toBeNull(); expect(f.runtime.multiplier('sleep')).toBe(1);
  f.runtime.opportunity(); await flush(); f.nextGeneration(); expect(f.runtime.multiplier('sleep')).toBe(1);
  let finish: ((value: MemoryResult<MotivationRecord | null>) => void) | undefined;
  vi.mocked(f.repository.read).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const read = f.runtime.restore(); await flush(); f.runtime.dispose();
  finish?.({ ok: true, value: f.state }); await read;
  expect(f.runtime.multiplier('sleep')).toBe(1);
});
it('storage failure disables only optional goals; successful ordinary reads do not generate a catch-up stream', async () => {
  const f = fixture();
  vi.mocked(f.repository.read).mockResolvedValueOnce({ ok: false, code: 'unavailable' });
  f.runtime.opportunity(); await flush(); expect(f.onFailure).toHaveBeenCalledWith('unavailable');
  expect(f.runtime.multiplier('sleep')).toBe(1); expect(f.repository.replace).not.toHaveBeenCalled();
  await f.runtime.restore(); expect(f.state).toBeNull();
  f.setNow(86400000); f.runtime.opportunity(); await flush();
  expect(f.state?.goals).toHaveLength(2); expect(f.repository.replace).toHaveBeenCalledTimes(1);
  f.runtime.cancel(); await flush(); expect(f.state?.goals.map(g => g.status)).toEqual(['cancelled', 'cancelled']);
});
it('does not retain an offline opportunity and create goals during a later restore', async () => {
  const f = fixture(); f.setOffline(true); f.runtime.opportunity(); await flush();
  expect(f.repository.read).not.toHaveBeenCalled(); expect(f.repository.replace).not.toHaveBeenCalled();
  f.setOffline(false); await f.runtime.restore();
  expect(f.state).toBeNull(); expect(f.runtime.multiplier('sleep')).toBe(1);
  f.runtime.opportunity(); await flush(); expect(f.state?.goals).toHaveLength(2);
});
it('clears run deduplication with generation reset so old IDs cannot suppress a new profile goal', async () => {
  const f = fixture(); f.runtime.opportunity(); await flush();
  f.runtime.activityStarted('old-rest', 'rest'); f.runtime.activityOutcome('old-rest', 'completed'); await flush();
  expect(f.state?.goals[0]?.status).toBe('completed');
  f.reset(); f.runtime.opportunity(); await flush();
  expect(f.runtime.multiplier('sleep')).toBe(1.2);
  f.runtime.activityStarted('new-rest', 'rest'); f.runtime.activityOutcome('new-rest', 'completed'); await flush();
  expect(f.state?.goals[0]?.status).toBe('completed');
});
it('a transient busy read stays neutral and a new fresh opportunity can reread without aborting shared storage', async () => {
  const f = fixture(); vi.mocked(f.repository.read).mockResolvedValueOnce({ ok: false, code: 'busy' });
  f.runtime.opportunity(); await flush();
  expect(f.runtime.selectedGoalKind()).toBeNull(); expect(f.onFailure).not.toHaveBeenCalled();
  f.runtime.opportunity(); await flush();
  expect(f.runtime.selectedGoalKind()).toBe('recover_energy'); expect(f.state?.goals).toHaveLength(2);
});
