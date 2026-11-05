import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { MOTIVATION_SCHEMA, MotivationStore } from '../../../src/infrastructure/memory/motivation-store';
import { evaluateOwnGoals, initialMotivation } from '../../../src/domain/character/own-goals';

const start = '2026-11-05T10:00:00.000Z';
const at = (ms: number) => new Date(Date.parse(start) + ms).toISOString();
function fixture() { const db = new Database(':memory:'); db.exec(MOTIVATION_SCHEMA); return { db, store: new MotivationStore(db) }; }
function goals() { let n = 0; return evaluateOwnGoals(initialMotivation(start), { energy: 35, boredom: 65 }, start, () => `goal-${++n}`); }
it('uses an atomic CAS singleton, accepts exact lost-ack replay and rejects changed identity/revision', () => {
  const { db, store } = fixture();
  try {
    const value = goals(); store.replace({ value, expectedRevision: null });
    store.replace({ value, expectedRevision: null });
    expect(store.read(start)).toEqual(value);
    expect(() => store.replace({ value: { ...value, recoveryArmed: true }, expectedRevision: null })).toThrow();
    expect(() => store.replace({ value: { ...value, revision: 2, goals: value.goals.map(g => ({ ...g, expiresAt: at(700000) })) }, expectedRevision: 1 })).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM own_motivation').get()).toEqual({ n: 1 });
  } finally { db.close(); }
});
it('preserves pending on a new store instance but expires/cancels using explicit supplied time', () => {
  const { db, store } = fixture();
  try {
    store.replace({ value: goals(), expectedRevision: null });
    const restarted = new MotivationStore(db);
    expect(restarted.read(at(1000))?.goals.map(g => g.status)).toEqual(['pending', 'pending']);
    expect(restarted.read(at(600000))?.goals.map(g => g.status)).toEqual(['expired', 'expired']);
    restarted.clear(); store.replace({ value: goals(), expectedRevision: null });
    expect(restarted.read(at(-1))?.goals.map(g => g.status)).toEqual(['cancelled', 'cancelled']);
    expect(restarted.read(at(1000))?.goals.map(g => g.status)).toEqual(['cancelled', 'cancelled']);
  } finally { db.close(); }
});
it('rejects malformed caps/latches/dates and rolls back the whole replacement', () => {
  const { db, store } = fixture();
  try {
    const value = goals(); store.replace({ value, expectedRevision: null });
    for (const bad of [{ ...value, goals: [...value.goals, value.goals[0]] }, { ...value, noveltyArmed: 1 },
      { ...value, lastSeenAt: 'invalid' }, { ...value, extra: 'private' }, { ...value, goals: value.goals.map(g => ({ ...g, createdAt: at(1) })) }]) {
      expect(() => store.replace({ value: bad, expectedRevision: 1 })).toThrow();
    }
    expect(store.read(start)).toEqual(value);
    store.clear(); expect(store.read(start)).toBeNull();
  } finally { db.close(); }
});
