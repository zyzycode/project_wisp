import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { MOTIVATION_SCHEMA, MotivationStore } from '../../../src/infrastructure/memory/motivation-store';
import { evaluateOwnGoals, initialMotivation } from '../../../src/domain/character/own-goals';
import { claimOwnPlan, finishOwnPlan, prepareOwnPlan } from '../../../src/domain/character/own-plans';

const now = '2026-11-05T10:00:00.000Z', needs = { energy: 70, boredom: 70 };
function value() { return { ...prepareOwnPlan(evaluateOwnGoals(initialMotivation(now), needs, now, kind => kind), needs, now), revision: 1 }; }
it('atomically preserves current claims, rejects unclaimed advancement and abandons only at startup recovery', () => {
  const db = new Database(':memory:'); db.exec(MOTIVATION_SCHEMA); const store = new MotivationStore(db);
  try {
    const initial = value(); store.replace({ value: initial, expectedRevision: null });
    expect(() => store.replace({ value: { ...initial, revision: 2, plan: { ...initial.plan, stepIndex: 1, attempts: 1 } }, expectedRevision: 1 })).toThrow();
    const claim = claimOwnPlan(initial, needs, now, 'app', 'token')!;
    store.replace({ value: claim, expectedRevision: 1 });
    store.replace({ value: claim, expectedRevision: 1 });
    expect(store.read(now)?.plan?.claim?.stepToken).toBe('token');
    expect(() => store.replace({ value: { ...claim, revision: 3, plan: { ...claim.plan, claim: { appRunId: 'other', stepToken: 'next', runId: null } } }, expectedRevision: 2 })).toThrow();
    expect(store.read(now, true)?.goals[0]?.status).toBe('abandoned');
    expect(store.read(now)?.plan).toBeNull();
  } finally { db.close(); }
});
it('persists one completed step then final completion without replaying a used token', () => {
  const db = new Database(':memory:'); db.exec(MOTIVATION_SCHEMA); const store = new MotivationStore(db);
  try {
    let record = value(); store.replace({ value: record, expectedRevision: null });
    for (const [token, run] of [['a', 'explore'], ['b', 'calm']]) {
      const claim = claimOwnPlan(record, needs, now, 'app', token!)!;
      store.replace({ value: claim, expectedRevision: record.revision });
      record = finishOwnPlan(claim, now, { appRunId: 'app', stepToken: token!, runId: run!, result: 'completed' });
      store.replace({ value: record, expectedRevision: claim.revision });
    }
    expect(store.read(now)?.goals[0]?.status).toBe('completed');
    expect(store.read(now)?.plan).toBeNull();
  } finally { db.close(); }
});
