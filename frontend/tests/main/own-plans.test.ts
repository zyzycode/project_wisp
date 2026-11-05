import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scenario } from './autonomy-scenario-fixture';
import { OwnGoalsRuntime } from '../../src/application/services/own-goals-runtime';
import { SqliteMemoryStore } from '../../src/infrastructure/memory/sqlite-store';
import { motivationRecord } from '../../src/infrastructure/memory/motivation-validation';
import type { IMotivationRepository } from '../../src/application/ports/motivation.interface';
import type { Operation } from '../../src/infrastructure/memory/protocol';

const base = Date.parse('2026-11-05T10:00:00.000Z');
const dirs: string[] = [], stores: SqliteMemoryStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
async function flush() { for (let n = 0; n < 60; n++) await Promise.resolve(); }
async function fixture(delayClaim = false) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wisp-plan-main-')); dirs.push(dir);
  const filename = path.join(dir, 'memory.db');
  const store = SqliteMemoryStore.open(filename, new Date(base).toISOString()); stores.push(store);
  const command = (operation: Operation, payload: unknown, generation = 0) => store.execute({ id: 1, operation, payload, generation });
  expect(command('replaceMotivation', { expectedRevision: null, value: { revision: 1,
    goals: (['recover_energy', 'seek_novelty'] as const).map(kind => ({ id: kind, kind, status: 'pending',
      createdAt: new Date(base).toISOString(), expiresAt: new Date(base + 600000).toISOString() })),
    plan: null, noveltyArmed: false, recoveryArmed: false, lastSeenAt: new Date(base).toISOString() } }).ok).toBe(true);
  let acknowledge: (() => void) | undefined;
  const repository: IMotivationRepository = {
    read: async (now, c) => { const r = command('readMotivation', now, c.generation); return r.ok ? { ok: true, value: r.value === null ? null : motivationRecord(r.value) } : r; },
    restore: async (now, c) => { const r = command('restoreMotivation', now, c.generation); return r.ok ? { ok: true, value: r.value === null ? null : motivationRecord(r.value) } : r; },
    replace: async (value, expectedRevision, c) => {
      const r = command('replaceMotivation', { value, expectedRevision }, c.generation);
      if (delayClaim && value.plan?.claim && r.ok) await new Promise<void>(resolve => { acknowledge = resolve; });
      return r.ok ? { ok: true, value: undefined } : r;
    },
  };
  let runtime: OwnGoalsRuntime | undefined, id = 0;
  const f = scenario({ energy: 35, comfort: 75, boredom: 40, play: 0, attention: 0 }, .999, undefined, undefined, {
    ownGoals: { opportunity: () => runtime?.opportunity(), selectedGoalKind: () => runtime?.selectedGoalKind() ?? null,
      selectedPlanStep: () => runtime?.selectedPlanStep() ?? null, offerPlanStep: (step, start) => runtime?.offerPlanStep(step, start) ?? false,
      interruptPlanAdmission: () => runtime?.interruptPlanAdmission(), cancel: () => runtime?.cancel() ?? Promise.resolve(), invalidate: () => runtime?.invalidate() },
    onActivityCommitted: (run, activity) => runtime?.activityStarted(run, activity),
    onActivityOutcome: event => runtime?.activityOutcome(event.activityRunId, event.outcome),
  });
  runtime = new OwnGoalsRuntime({ repository, context: () => ({ generation: 0 }), wallNow: () => base + f.now(),
    getNeeds: () => f.character.getState().needs, eligible: () => f.main.canInfluenceOwnGoals(), createId: () => `token-${++id}`,
    planning: { appRunId: () => 'app', onOpportunityFinished: () => f.main.finishOwnPlanOpportunity() } });
  await runtime.restore(); f.elapse(20000); runtime.opportunity(); await flush();
  const read = () => { const r = command('readMotivation', new Date(base + f.now()).toISOString()); if (!r.ok) throw Error(r.code); return motivationRecord(r.value); };
  const needs = (energy: number, boredom: number, comfort: number) => { const s = f.character.getState(); f.character.replaceRestoredState({ ...s, needs: { ...s.needs, energy, boredom, comfort } }); };
  return { ...f, runtime, filename, read, needs, acknowledge: () => acknowledge?.(), cleanup: () => { runtime?.dispose(); f.main.dispose(); } };
}
it('uses the existing Main runner for three acknowledged steps and completes novelty only after exact final calm', async () => {
  const f = await fixture();
  expect(f.runtime.selectedPlanStep()).toBe('rest');
  f.pulse(); await flush();
  expect(['rest', 'rest_spot_nap', 'rest_spot_sleep']).toContain(f.main.getActivityTimeline()?.activityId);
  expect(f.read().plan?.claim?.appRunId).toBe('app');
  f.finish(); await flush();
  expect(f.read().plan).toMatchObject({ stepIndex: 1, attempts: 1, claim: null });
  f.needs(70, 70, 60); f.setRandom(.9); f.pulse(); await flush();
  expect(f.main.getActivityTimeline()?.activityId).toBe('explore');
  f.finish(); await flush();
  expect(f.read().goals.find(g => g.kind === 'seek_novelty')?.status).toBe('pending');
  expect(f.read().plan).toMatchObject({ stepIndex: 2, attempts: 2, claim: null });
  f.needs(70, 20, 60); f.setRandom(0); f.pulse(); await flush();
  expect(f.main.getActivityTimeline()?.activityId).toBe('calm');
  expect(f.main.getVisualEpisode()?.intent.kind).toBe('look_around');
  f.finish(); await flush();
  expect(f.read().plan).toBeNull();
  expect(f.read().goals.find(g => g.kind === 'seek_novelty')?.status).toBe('completed');
  expect(f.outcomes.filter(event => event.outcome === 'completed')).toHaveLength(3);
  f.cleanup();
});
it('reopens SQLite without replaying a persisted claim', async () => {
  const f = await fixture(); f.pulse(); await flush();
  expect(f.read().plan?.claim).not.toBeNull(); f.cleanup();
  const old = stores.pop()!; old.close();
  const reopened = SqliteMemoryStore.open(f.filename, new Date(base + f.now()).toISOString()); stores.push(reopened);
  const r = reopened.execute({ id: 2, operation: 'restoreMotivation', payload: new Date(base + f.now()).toISOString(), generation: 0 });
  expect(r.ok).toBe(true); if (!r.ok) return;
  expect(motivationRecord(r.value).plan).toBeNull();
  expect(motivationRecord(r.value).goals.find(g => g.kind === 'seek_novelty')?.status).toBe('abandoned');
});
it.each(['contact', 'changed-needs'] as const)('keeps Rest unstarted until claim ack and rejects stale %s admission', async mode => {
  const f = await fixture(true); f.pulse(); await flush();
  expect(f.read().plan?.claim).not.toBeNull();
  expect(f.main.getActivityTimeline()).toBeNull();
  expect(f.main.getSemanticSleepState()).toBe('awake');
  if (mode === 'contact') f.main.suspendForUserInteraction();
  else f.needs(90, 40, 60);
  f.acknowledge(); await flush();
  expect(f.main.getActivityTimeline()).toBeNull();
  expect(f.main.getSemanticSleepState()).toBe('awake');
  expect(f.read().plan).toBeNull();
  expect(f.read().goals.find(g => g.kind === 'seek_novelty')?.status).toBe('abandoned');
  f.cleanup();
});
