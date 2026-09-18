import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import { initializeSchema } from '../../../src/infrastructure/memory/schema';
import type { Operation } from '../../../src/infrastructure/memory/protocol';

const now = '2026-09-18T10:00:00.000Z';
const later = '2026-09-18T11:00:00.000Z';
const directories: string[] = [];
const stores: SqliteMemoryStore[] = [];
function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wisp memory тест ')); directories.push(directory);
  const filename = path.join(directory, 'memory.sqlite3');
  const store = SqliteMemoryStore.open(filename, now); stores.push(store);
  return { store, filename };
}
function run(store: SqliteMemoryStore, operation: Operation, payload: unknown = null, generation = 0) { return store.execute({ id: 1, operation, payload, generation }); }
function turn(suffix = '') { return {
  session: { id: 'session', appRunId: 'app', startedAt: now, endedAt: null },
  user: { id: `u${suffix}`, conversationSessionId: 'session', role: 'user', content: 'Привет', createdAt: now },
  assistant: { id: `a${suffix}`, conversationSessionId: 'session', role: 'assistant', content: 'Рада тебя видеть', createdAt: now },
}; }
const fact = { id: 'fact', factKey: 'name', factValue: 'Ира', confidence: 1, sourceMessageId: null, createdAt: now, updatedAt: now };
const episode = { appRunId: 'app', activityRunId: 'game', kind: 'cursor_game', outcome: 'caught', playCompleted: true, executedMs: 500, endedAt: now };
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('SQLite memory', () => {
  it('creates exact schema once with durable pragmas and recovers sessions on restart', () => {
    const { store, filename } = fixture();
    expect(run(store, 'appendTurn', turn()).ok).toBe(true); store.close();
    const reopened = SqliteMemoryStore.open(filename, later); stores.push(reopened);
    const db = new Database(filename);
    expect(db.prepare('SELECT sqlite_version() AS version').get()).toEqual({ version: '3.53.4' });
    expect(db.prepare('SELECT count(*) AS count FROM schema_migrations').get()).toEqual({ count: 1 });
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.prepare('SELECT ended_at FROM conversation_sessions').get()).toEqual({ ended_at: later }); db.close();
    expect(run(reopened, 'getRecent', 2)).toEqual({ ok: true, value: [turn().user, turn().assistant] });
  });
  it('appends whole pairs idempotently and rolls back a conflicting pair without an empty session', () => {
    const { store, filename } = fixture(); const t = turn();
    expect(run(store, 'appendTurn', t).ok).toBe(true);
    expect(run(store, 'appendTurn', t).ok).toBe(true);
    expect(run(store, 'appendTurn', { ...t, assistant: { ...t.assistant, content: 'Changed' } })).toEqual({ ok: false, code: 'conflict' });
    expect(run(store, 'appendTurn', { ...t, user: { ...t.user, id: 'fresh' } })).toEqual({ ok: false, code: 'conflict' });
    expect(run(store, 'getRecent', 100)).toEqual({ ok: true, value: [t.user, t.assistant] });
    const db = new Database(filename); expect(db.prepare('SELECT count(*) AS count FROM conversation_sessions').get()).toEqual({ count: 1 }); db.close();
  });
  it('keeps insertion order despite clock rollback, bounds reads and validates stored roles', () => {
    const { store, filename } = fixture(); const t = turn('2');
    run(store, 'appendTurn', turn());
    run(store, 'appendTurn', { ...t, user: { ...t.user, createdAt: '2025-01-01T00:00:00.000Z' } });
    const result = run(store, 'getRecent', 2); expect(result.ok && Array.isArray(result.value) && result.value[0].id).toBe('u2');
    expect(run(store, 'getRecent', 0)).toEqual({ ok: false, code: 'invalid_data' });
    const db = new Database(filename); db.prepare("UPDATE messages SET role = 'system'").run(); db.close();
    expect(run(store, 'getRecent', 2)).toEqual({ ok: false, code: 'invalid_data' });
  });
  it('upserts facts by key preserving identity and enforces source FK', () => {
    const { store } = fixture(); run(store, 'upsertFact', fact);
    expect(run(store, 'upsertFact', { ...fact, id: 'candidate', factValue: 'Лена', createdAt: later, updatedAt: '2020-01-01T00:00:00.000Z' })).toEqual({ ok: true, value: { ...fact, factValue: 'Лена', updatedAt: now } });
    expect(run(store, 'upsertFact', { ...fact, sourceMessageId: 'missing' })).toEqual({ ok: false, code: 'conflict' });
    expect(run(store, 'listFacts', 1).ok).toBe(true);
    expect(run(store, 'removeFact', 'name').ok).toBe(true); expect(run(store, 'removeFact', 'name').ok).toBe(true);
    expect(run(store, 'listFacts', 10)).toEqual({ ok: true, value: [] });
  });
  it('deduplicates game outcomes without changing the first terminal', () => {
    const { store } = fixture();
    expect(run(store, 'appendEpisode', episode).ok).toBe(true);
    expect(run(store, 'appendEpisode', episode).ok).toBe(true);
    expect(run(store, 'appendEpisode', { ...episode, outcome: 'missed' })).toEqual({ ok: false, code: 'conflict' });
    expect(run(store, 'appendEpisode', { ...episode, appRunId: 'next' }).ok).toBe(true);
    expect(run(store, 'appendEpisode', { ...episode, playCompleted: false })).toEqual({ ok: false, code: 'invalid_data' });
  });
  it('validates snapshot envelopes without interpreting domain state and preserves malformed rows', () => {
    const { store, filename } = fixture(); const snapshot = { snapshotVersion: 1, state: { preferences: {} }, updatedAt: now };
    expect(run(store, 'saveSnapshot', snapshot).ok).toBe(true);
    expect(run(store, 'loadSnapshot')).toEqual({ ok: true, value: snapshot });
    const db = new Database(filename); db.prepare("UPDATE character_state SET snapshot_json = 'invalid'").run();
    expect(run(store, 'loadSnapshot')).toEqual({ ok: false, code: 'invalid_data' });
    expect(db.prepare('SELECT snapshot_json FROM character_state').get()).toEqual({ snapshot_json: 'invalid' }); db.close();
    expect(run(store, 'listFacts', 1).ok).toBe(true);
  });
  it('clears all user tables but keeps schema and rejects late writes from old generations', () => {
    const { store, filename } = fixture(); run(store, 'appendTurn', turn()); run(store, 'upsertFact', fact); run(store, 'appendEpisode', episode);
    run(store, 'saveSnapshot', { snapshotVersion: 1, state: {}, updatedAt: now });
    expect(run(store, 'clear', null, 1).ok).toBe(true);
    expect(run(store, 'appendTurn', turn())).toEqual({ ok: false, code: 'stale' });
    expect(run(store, 'clear', null, 1)).toEqual({ ok: false, code: 'stale' });
    expect(run(store, 'getRecent', 10, 1)).toEqual({ ok: true, value: [] });
    expect(run(store, 'loadSnapshot', null, 1)).toEqual({ ok: true, value: null });
    const db = new Database(filename); for (const table of ['conversation_sessions', 'messages', 'user_facts', 'game_episodes', 'character_state']) expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({ n: 1 }); db.close();
  });
  it('retains the generation barrier and every row when reset rolls back', () => {
    const { store, filename } = fixture(); run(store, 'appendTurn', turn()); run(store, 'upsertFact', fact);
    const db = new Database(filename); db.exec("CREATE TRIGGER prevent_clear BEFORE DELETE ON messages BEGIN SELECT RAISE(ABORT, 'test'); END;");
    expect(run(store, 'clear', null, 1)).toEqual({ ok: false, code: 'conflict' });
    expect(run(store, 'listFacts', 10, 1)).toEqual({ ok: true, value: [fact] });
    expect(run(store, 'appendEpisode', episode)).toEqual({ ok: false, code: 'stale' }); db.close();
  });
  it.each(['future', 'journal', 'unknown'])('refuses %s schema without recreating the database', kind => {
    const { store, filename } = fixture(); store.close(); const db = new Database(filename);
    if (kind === 'future') db.pragma('user_version = 99');
    if (kind === 'journal') db.exec("UPDATE schema_migrations SET name = 'changed'");
    if (kind === 'unknown') db.pragma('user_version = 0');
    db.close(); expect(() => SqliteMemoryStore.open(filename, now)).toThrow(kind === 'future' ? 'unsupported_version' : 'corrupt');
    const check = new Database(filename); expect(check.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({ n: 1 }); check.close();
  });
  it('rolls back first migration DDL and user_version together on storage denial', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'wisp-migration-')); directories.push(directory);
    const db = new Database(path.join(directory, 'db'));
    db.pragma('journal_mode = WAL'); db.pragma('query_only = ON');
    expect(() => initializeSchema(db, now)).toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(0);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([]); db.close();
  });
  it.each([NaN, Infinity, -1, 1.5])('rejects invalid generation %s', generation => {
    const { store } = fixture(); expect(run(store, 'getRecent', 1, generation)).toEqual({ ok: false, code: 'invalid_data' });
  });
  it('rejects invalid calendar dates and non-finite episode duration', () => {
    const { store } = fixture(); expect(run(store, 'appendEpisode', { ...episode, endedAt: '2026-02-30T00:00:00.000Z' })).toEqual({ ok: false, code: 'invalid_data' });
    expect(run(store, 'appendEpisode', { ...episode, executedMs: Infinity })).toEqual({ ok: false, code: 'invalid_data' });
  });
});
