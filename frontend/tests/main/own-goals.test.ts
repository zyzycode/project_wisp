import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scenario } from './autonomy-scenario-fixture';
import { OwnGoalsRuntime } from '../../src/application/services/own-goals-runtime';
import { SqliteMemoryStore } from '../../src/infrastructure/memory/sqlite-store';
import { motivationRecord } from '../../src/infrastructure/memory/motivation-validation';
import type { IMotivationRepository, MotivationRecord, OwnGoalKind } from '../../src/application/ports/motivation.interface';
import type { MemoryResult } from '../../src/application/ports/memory-repository.interface';
import type { Operation } from '../../src/infrastructure/memory/protocol';

const base = Date.parse('2026-11-05T10:00:00.000Z');
const dirs: string[] = [], stores: SqliteMemoryStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
async function flush() { for (let n = 0; n < 20; n++) await Promise.resolve(); }
async function fixture(kind: OwnGoalKind, reentrantCancel = false) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wisp-own-goal-main-')); dirs.push(dir);
  const store = SqliteMemoryStore.open(path.join(dir, 'memory.db'), new Date(base).toISOString()); stores.push(store);
  const command = (operation: Operation, payload: unknown, generation = 0) => store.execute({ id: 1, operation, payload, generation });
  const value: MotivationRecord = { revision: 1, goals: [{ id: 'goal', kind, createdAt: new Date(base).toISOString(), expiresAt: new Date(base + 600000).toISOString(), status: 'pending' }],
    plan: null, noveltyArmed: false, recoveryArmed: false, lastSeenAt: new Date(base).toISOString() };
  expect(command('replaceMotivation', { value, expectedRevision: null }).ok).toBe(true);
  function empty(result: MemoryResult<unknown>): MemoryResult<void> { if (!result.ok) return result; expect(result.value).toBeUndefined(); return { ok: true, value: undefined }; }
  const repository: IMotivationRepository = {
    read: async (now, c) => { const result = command('readMotivation', now, c.generation); return result.ok ? { ok: true, value: result.value === null ? null : motivationRecord(result.value) } : result; },
    replace: async (next, expectedRevision, c) => empty(command('replaceMotivation', { value: next, expectedRevision }, c.generation)),
  };
  let runtime: OwnGoalsRuntime | undefined, id = 0, cancelled = false;
  // Keep both goal families available while the comfort deficit excludes the unrelated book peer.
  const f = scenario({ energy: 45, comfort: 75, boredom: 40, play: 0, attention: 0 }, .9, undefined, undefined, {
    ownGoals: { opportunity: () => runtime?.opportunity(), selectedGoalKind: () => runtime?.selectedGoalKind() ?? null,
      cancel: () => runtime?.cancel() ?? Promise.resolve(), invalidate: () => runtime?.invalidate() },
    onActivityCommitted: (run, activity) => runtime?.activityStarted(run, activity),
    onActivityOutcome: event => runtime?.activityOutcome(event.activityRunId, event.outcome),
    onPresentationChanged: () => { if (runtime && reentrantCancel && !cancelled && f.main.getActivityTimeline()) { cancelled = true; f.main.suspendForUserInteraction(); } },
  });
  runtime = new OwnGoalsRuntime({ repository, context: () => ({ generation: 0 }), wallNow: () => base + f.now(),
    getNeeds: () => f.character.getState().needs, eligible: () => f.main.canInfluenceOwnGoals(), createId: () => `generated-${++id}` });
  await runtime.restore();
  const read = () => command('readMotivation', new Date(base + f.now()).toISOString());
  return { ...f, runtime, read, cleanup: () => { runtime?.dispose(); f.main.dispose(); } };
}
it('the same Needs and RNG choose different allowed actual activities from different durable goals', async () => {
  const recovery = await fixture('recover_energy'), novelty = await fixture('seek_novelty');
  expect(recovery.main.getActivityTimeline()).toBeNull(); expect(novelty.main.getActivityTimeline()).toBeNull();
  recovery.pulse(); novelty.pulse(); await flush();
  expect(['rest', 'rest_spot_nap', 'rest_spot_sleep']).toContain(recovery.main.getActivityTimeline()?.activityId);
  expect(novelty.main.getActivityTimeline()?.activityId).toBe('explore');
  recovery.finish(); novelty.finish(); await flush();
  expect(recovery.read()).toMatchObject({ ok: true, value: { goals: [{ status: 'completed' }] } });
  expect(novelty.read()).toMatchObject({ ok: true, value: { goals: [{ status: 'completed' }] } });
  recovery.cleanup(); novelty.cleanup();
});
it('binds before first visual callback so a reentrant user cancellation cannot leave a pending successful attempt', async () => {
  const f = await fixture('recover_energy', true); f.pulse(); await flush();
  expect(f.main.getActivityTimeline()).toBeNull();
  expect(f.read()).toMatchObject({ ok: true, value: { goals: [{ status: 'cancelled' }] } });
  f.cleanup();
});
it('quiet only pauses a goal while disabling explicitly cancels it without changing baseline admission', async () => {
  const f = await fixture('seek_novelty'); f.main.setQuietMode(true);
  expect(f.runtime.selectedGoalKind()).toBeNull();
  expect(f.read()).toMatchObject({ ok: true, value: { goals: [{ status: 'pending' }] } });
  f.main.setQuietMode(false); expect(f.runtime.selectedGoalKind()).toBe('seek_novelty');
  f.main.setEnabled(false); await flush();
  expect(f.read()).toMatchObject({ ok: true, value: { goals: [{ status: 'cancelled' }] } });
  f.cleanup();
});
it('a pending novelty goal cannot compete with critical sleep or start its own executor', async () => {
  const f = await fixture('seek_novelty');
  const state = f.character.getState();
  f.character.replaceRestoredState({ ...state, needs: { ...state.needs, energy: 5 } });
  f.main.tick(); await flush();
  expect(f.runtime.selectedGoalKind()).toBeNull();
  expect(f.main.getActivityTimeline()?.activityId).toBe('rest_spot_sleep');
  expect(f.read()).toMatchObject({ ok: true, value: { goals: [{ status: 'pending' }] } });
  f.cleanup();
});
