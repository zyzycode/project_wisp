import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { SOCIAL_INTERPRETATION_SCHEMA, SocialInterpretationStore } from '../../../src/infrastructure/memory/social-interpretation-store';
import { CAUSAL_LIFE_SCHEMA } from '../../../src/infrastructure/memory/causal-life-store';
import { addInterruptionReport, createInterruptionInterpretation } from '../../../src/domain/character/social-interpretation';

const now = '2026-11-05T10:00:10.000Z';
const episode = { appRunId: 'app', sequence: 2, revision: 1 as const, occurredAt: '2026-11-05T10:00:00.000Z', source: 'user' as const,
  activityRunId: 'game', activity: 'cursor_game' as const, outcome: 'cancelled' as const, terminalReason: 'user_interaction' as const,
  cause: 'user_interrupted' as const, triggerSequence: 1, executedMs: 2000, participation: 'user_engaged' as const };
const sources = [
  { conversationSessionId: 'session', userMessageId: 'u1', revision: 1 as const, report: 'accidental' as const },
  { conversationSessionId: 'session', userMessageId: 'u2', revision: 1 as const, report: 'deliberate' as const },
];
const dbs: Database.Database[] = [];
function fixture() {
  const db = new Database(':memory:'); dbs.push(db); db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE conversation_sessions(id TEXT PRIMARY KEY,app_run_id TEXT NOT NULL UNIQUE);
    CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_session_id TEXT NOT NULL REFERENCES conversation_sessions(id),role TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL);`);
  db.exec(CAUSAL_LIFE_SCHEMA + SOCIAL_INTERPRETATION_SCHEMA);
  db.prepare('INSERT INTO causal_life_episodes VALUES (?,?,?,?)').run('app', 2, 'game', JSON.stringify(episode));
  db.prepare('INSERT INTO conversation_sessions VALUES (?,?)').run('session', 'app');
  const insert = db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)');
  insert.run('u1', 'session', 'user', 'я случайно прервал игру', now);
  insert.run('u2', 'session', 'user', 'i interrupted the game deliberately', now);
  const store = new SocialInterpretationStore(db), initial = createInterruptionInterpretation(episode, 1)!;
  store.replace({ value: initial, expectedRevision: null, now });
  return { db, store, initial };
}
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

it('persists a source-linked CAS singleton, idempotent reports and contradiction without changing the fact', () => {
  const { db, store, initial } = fixture(), first = addInterruptionReport(initial, sources[0]!);
  store.replace({ value: first, expectedRevision: 1, now }); store.replace({ value: first, expectedRevision: 1, now });
  expect(store.read(now)).toEqual(first);
  const second = addInterruptionReport(first, sources[1]!);
  store.replace({ value: second, expectedRevision: 2, now }); expect(store.read(now)).toEqual(second);
  expect(() => store.replace({ value: initial, expectedRevision: 1, now })).toThrow('conflict');
  expect(db.prepare('SELECT payload FROM causal_life_episodes').get()).toEqual({ payload: JSON.stringify(episode) });
});

it('requires the exact committed user source, storage session and approved report text', () => {
  const { db, store, initial } = fixture();
  for (const source of [{ ...sources[0]!, userMessageId: 'absent' }, { ...sources[0]!, conversationSessionId: 'wrong' }, { ...sources[0]!, report: 'deliberate' as const }]) {
    expect(() => store.replace({ value: addInterruptionReport(initial, source), expectedRevision: 1, now })).toThrow('conflict');
  }
  db.prepare("UPDATE messages SET role='assistant' WHERE id='u1'").run();
  expect(() => store.replace({ value: addInterruptionReport(initial, sources[0]!), expectedRevision: 1, now })).toThrow('conflict');
  expect(store.read(now)).toEqual(initial);
});

it('invalidates all reports atomically when either source is deleted or corrected, retaining unknown fact', () => {
  const { db, store, initial } = fixture(), first = addInterruptionReport(initial, sources[0]!);
  const second = addInterruptionReport(first, sources[1]!);
  store.replace({ value: first, expectedRevision: 1, now }); store.replace({ value: second, expectedRevision: 2, now });
  db.prepare("DELETE FROM messages WHERE id='u1'").run();
  expect(db.prepare('SELECT status,revision FROM social_interpretation').get()).toEqual({ status: 'unknown', revision: 4 });
  expect(db.prepare('SELECT * FROM social_interpretation_reports').all()).toEqual([]);
  expect(store.read(now)).toEqual({ ...initial, revision: 4 });
  const next = addInterruptionReport({ ...initial, revision: 4 }, sources[1]!);
  store.replace({ value: next, expectedRevision: 4, now });
  db.prepare("UPDATE messages SET content='changed' WHERE id='u2'").run();
  expect(store.read(now)).toEqual({ ...initial, revision: 6 });
});

it('expires or omits clock reversal, rejects late reports, and cascades source reset', () => {
  const { db, store, initial } = fixture();
  expect(() => store.replace({ value: addInterruptionReport(initial, sources[0]!), expectedRevision: 1, now: '2026-11-05T10:05:00.001Z' })).toThrow('conflict');
  expect(store.read('2026-11-05T09:59:59.999Z')).toBeNull();
  store.replace({ value: initial, expectedRevision: null, now });
  expect(store.read(initial.expiresAt)).toBeNull();
  store.replace({ value: initial, expectedRevision: null, now });
  db.prepare('DELETE FROM causal_life_episodes').run();
  expect(store.read(now)).toBeNull(); expect(db.prepare('SELECT * FROM social_interpretation_reports').all()).toEqual([]);
});
