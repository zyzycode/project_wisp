import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import { initializeSchema } from '../../../src/infrastructure/memory/schema';
import type { Operation } from '../../../src/infrastructure/memory/protocol';
import type { MemoryItemMutation } from '../../../src/application/ports/memory-items.interface';
const now = '2026-10-17T10:00:00.000Z';
const directories: string[] = [], stores: SqliteMemoryStore[] = [];
function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wisp-cards-')); directories.push(directory);
  const filename = path.join(directory, 'memory.sqlite3');
  const store = SqliteMemoryStore.open(filename, now); stores.push(store);
  return { store, filename };
}
function run(store: SqliteMemoryStore, operation: Operation, payload: unknown = null, generation = 0) { return store.execute({ id: 1, operation, payload, generation }); }
function turn(id = '', confirmable = true) { return { memoryConfirmable: confirmable,
  session: { id: 'session', appRunId: 'app', startedAt: now, endedAt: null },
  user: { id: `u${id}`, conversationSessionId: 'session', role: 'user', content: 'Мы увидели северное сияние', createdAt: now },
  assistant: { id: `a${id}`, conversationSessionId: 'session', role: 'assistant', content: 'Северное сияние запомнилось', createdAt: now },
}; }
function confirm(id = ''): Extract<MemoryItemMutation, { kind: 'confirm' }> { return { kind: 'confirm', commandId: `command${id}`, itemId: `item${id}`, expectedRevision: 0, confirmed: true,
  content: { category: 'important_event', label: 'Сияние', text: 'Мы увидели северное сияние', occurredOn: null }, source: { userMessageId: `u${id}`, assistantMessageId: `a${id}` }, confirmedAt: now }; }
function list(store: SqliteMemoryStore, generation: number) { return run(store, 'listMemoryItems', { cursor: null, limit: 20 }, generation); }
function raw(filename: string, sql: string) { const db = new Database(filename); try { return db.prepare(sql).all(); } finally { db.close(); } }
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('explicit persisted memory cards', () => {
  it('commits evidence/index/receipt once, survives restart and suppresses the retained transcript', () => {
    const f = fixture(); run(f.store, 'appendTurn', turn());
    expect(run(f.store, 'mutateMemoryItem', confirm(), 1)).toMatchObject({ ok: true, value: { revision: 1, outcome: 'active' } });
    expect(list(f.store, 1)).toMatchObject({ ok: true, value: { items: [{ id: 'item', text: 'Мы увидели северное сияние', revision: 1, source: confirm().source }] } });
    expect(run(f.store, 'getRecent', 100, 1)).toEqual({ ok: true, value: [] });
    expect(raw(f.filename, 'SELECT count(*) AS n FROM messages')).toEqual([{ n: 2 }]);
    expect(raw(f.filename, 'SELECT token FROM memory_item_terms ORDER BY token')).toEqual([{ token: 'мы' }, { token: 'северное' }, { token: 'сияние' }, { token: 'увидели' }]);
    f.store.close(); const reopened = SqliteMemoryStore.open(f.filename, now); stores.push(reopened);
    expect(list(reopened, 0)).toMatchObject({ ok: true, value: { items: [{ id: 'item', revision: 1 }] } });
    expect(run(reopened, 'mutateMemoryItem', { ...confirm(), confirmedAt: '2026-10-18T10:00:00.000Z' }, 1)).toMatchObject({ ok: true, value: { revision: 1 } });
    expect(raw(f.filename, 'SELECT count(*) AS n FROM memory_mutation_receipts')).toEqual([{ n: 1 }]);
    expect(run(reopened, 'getRecent', 100, 1)).toEqual({ ok: true, value: [] });
  });
  it('enforces CAS, digest replay and own-source correction; suppresses every historic source', () => {
    const f = fixture(); run(f.store, 'appendTurn', turn()); run(f.store, 'appendTurn', turn('2'));
    const c = confirm(); run(f.store, 'mutateMemoryItem', c, 1);
    expect(run(f.store, 'mutateMemoryItem', c, 2)).toMatchObject({ ok: true, value: { revision: 1 } });
    expect(run(f.store, 'mutateMemoryItem', { ...c, content: { ...c.content, text: 'changed' } }, 3)).toEqual({ ok: false, code: 'conflict' });
    expect(run(f.store, 'mutateMemoryItem', { ...c, kind: 'update', commandId: 'bad-cas', expectedRevision: 5 }, 4)).toEqual({ ok: false, code: 'conflict' });
    const update = { ...c, kind: 'update', commandId: 'update', expectedRevision: 1, source: confirm('2').source, content: { ...c.content, text: 'Исправленное событие' } };
    expect(run(f.store, 'mutateMemoryItem', update, 5)).toMatchObject({ ok: true, value: { revision: 2 } });
    expect(raw(f.filename, 'SELECT count(*) AS n FROM memory_item_sources')).toEqual([{ n: 2 }]);
    expect(run(f.store, 'getRecent', 100, 5)).toEqual({ ok: true, value: [] });
    expect(run(f.store, 'mutateMemoryItem', { ...update, commandId: 'own-source', expectedRevision: 2 }, 6)).toMatchObject({ ok: true, value: { revision: 3 } });
    expect(run(f.store, 'mutateMemoryItem', { ...confirm(), commandId: 'other', itemId: 'other' }, 7)).toEqual({ ok: false, code: 'conflict' });
  });
  it('withdraws, explicitly re-confirms and deletes payload without leaking source text into receipts', () => {
    const f = fixture(); run(f.store, 'appendTurn', turn()); run(f.store, 'mutateMemoryItem', confirm(), 1);
    expect(run(f.store, 'mutateMemoryItem', { kind: 'withdraw', commandId: 'withdraw', itemId: 'item', expectedRevision: 1 }, 2)).toMatchObject({ ok: true, value: { outcome: 'withdrawn', revision: 2 } });
    expect(raw(f.filename, 'SELECT * FROM memory_item_terms')).toEqual([]);
    expect(list(f.store, 2)).toMatchObject({ ok: true, value: { items: [{ status: 'withdrawn' }] } });
    expect(run(f.store, 'mutateMemoryItem', { ...confirm(), kind: 'update', commandId: 'renew', expectedRevision: 2 }, 3)).toMatchObject({ ok: true, value: { outcome: 'active', revision: 3 } });
    const deletion = { kind: 'delete', commandId: 'delete', itemId: 'item', expectedRevision: 3 };
    expect(run(f.store, 'mutateMemoryItem', deletion, 4)).toMatchObject({ ok: true, value: { outcome: 'deleted', revision: 4 } });
    expect(run(f.store, 'mutateMemoryItem', deletion, 5)).toMatchObject({ ok: true, value: { outcome: 'deleted', revision: 4 } });
    for (const table of ['memory_items', 'memory_item_sources', 'memory_item_terms']) expect(raw(f.filename, `SELECT * FROM ${table}`)).toEqual([]);
    expect(JSON.stringify(raw(f.filename, 'SELECT * FROM memory_mutation_receipts'))).not.toContain('сияние');
    expect(raw(f.filename, 'SELECT * FROM memory_suppressed_pairs')).toHaveLength(1);
    expect(run(f.store, 'getRecent', 100, 5)).toEqual({ ok: true, value: [] });
  });
  it('rejects missing, fallback, partial, model-only and unconfirmed evidence', () => {
    const f = fixture(); run(f.store, 'appendTurn', turn('', false)); run(f.store, 'appendTurn', turn('2'));
    expect(run(f.store, 'mutateMemoryItem', confirm(), 1)).toEqual({ ok: false, code: 'invalid_data' });
    expect(run(f.store, 'mutateMemoryItem', confirm('missing'), 2)).toEqual({ ok: false, code: 'invalid_data' });
    expect(run(f.store, 'mutateMemoryItem', { ...confirm('2'), source: { userMessageId: 'a', assistantMessageId: 'a2' } }, 3)).toEqual({ ok: false, code: 'invalid_data' });
    expect(run(f.store, 'mutateMemoryItem', { ...confirm('2'), source: { userMessageId: 'u', assistantMessageId: 'a2' } }, 4)).toEqual({ ok: false, code: 'invalid_data' });
    expect(run(f.store, 'mutateMemoryItem', { ...confirm('2'), confirmed: false }, 5)).toEqual({ ok: false, code: 'invalid_data' });
    expect(raw(f.filename, 'SELECT * FROM memory_items')).toEqual([]);
    expect(run(f.store, 'appendTurn', turn('', true), 4)).toEqual({ ok: false, code: 'conflict' });
  });
  it('rolls back a failed index write including evidence and suppression, but keeps the generation barrier', () => {
    const f = fixture(); run(f.store, 'appendTurn', turn());
    const db = new Database(f.filename); db.exec("CREATE TRIGGER reject_term BEFORE INSERT ON memory_item_terms BEGIN SELECT RAISE(ABORT, 'test'); END;"); db.close();
    expect(run(f.store, 'mutateMemoryItem', confirm(), 1)).toEqual({ ok: false, code: 'conflict' });
    for (const table of ['memory_items', 'memory_item_sources', 'memory_item_terms', 'memory_suppressed_pairs', 'memory_mutation_receipts']) expect(raw(f.filename, `SELECT * FROM ${table}`)).toEqual([]);
    expect(run(f.store, 'getRecent', 100, 1)).toMatchObject({ ok: true, value: [turn().user, turn().assistant] });
    expect(run(f.store, 'appendTurn', turn('late'), 0)).toEqual({ ok: false, code: 'stale' });
  });
  it('bounds and pages at twenty, then atomically resets every new table', () => {
    const f = fixture(); for (let i = 0; i < 21; i++) { run(f.store, 'appendTurn', turn(String(i)), i); run(f.store, 'mutateMemoryItem', confirm(String(i)), i + 1); }
    expect(list(f.store, 21)).toMatchObject({ ok: true, value: { items: expect.any(Array), nextCursor: 2 } });
    const page = list(f.store, 21); expect(page.ok && typeof page.value === 'object' && page.value !== null && 'items' in page.value && Array.isArray(page.value.items) && page.value.items.length).toBe(20);
    expect(run(f.store, 'listMemoryItems', { cursor: 2, limit: 20 }, 21)).toMatchObject({ ok: true, value: { items: [{ id: 'item0' }], nextCursor: null } });
    expect(run(f.store, 'listMemoryItems', { cursor: null, limit: 21 }, 21)).toEqual({ ok: false, code: 'invalid_data' });
    expect(run(f.store, 'clear', null, 22).ok).toBe(true);
    for (const table of ['memory_items', 'memory_item_sources', 'memory_item_terms', 'memory_suppressed_pairs', 'memory_mutation_receipts', 'messages']) expect(raw(f.filename, `SELECT * FROM ${table}`)).toEqual([]);
    expect(raw(f.filename, 'SELECT version FROM schema_migrations')).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
  });
});

function downgradeFixture(filename: string): void {
  const db = new Database(filename); db.pragma('foreign_keys = OFF');
  db.exec('DROP TABLE interest_thread; DROP TABLE interest_thread_receipts; DELETE FROM schema_migrations WHERE version=3; DROP TABLE memory_item_terms; DROP TABLE memory_item_sources; DROP TABLE memory_items; DROP TABLE memory_suppressed_pairs; DROP TABLE memory_mutation_receipts; ALTER TABLE messages DROP COLUMN memory_confirmable; DELETE FROM schema_migrations WHERE version=2; PRAGMA user_version=1;'); db.close();
}
it('migrates schema1 without modifying legacy transcript or inferring confirmation eligibility', () => {
  const f = fixture(); run(f.store, 'appendTurn', turn()); f.store.close(); downgradeFixture(f.filename);
  const legacy = raw(f.filename, 'SELECT * FROM messages'); const reopened = SqliteMemoryStore.open(f.filename, now); stores.push(reopened);
  expect(raw(f.filename, 'SELECT sequence,id,conversation_session_id,role,content,created_at FROM messages')).toEqual(legacy);
  expect(raw(f.filename, 'SELECT memory_confirmable FROM messages')).toEqual([{ memory_confirmable: 0 }, { memory_confirmable: 0 }]);
  expect(run(reopened, 'mutateMemoryItem', confirm(), 1)).toEqual({ ok: false, code: 'invalid_data' });
});
it('rolls migration2 back to intact schema1 on failure and refuses future schema', () => {
  const f = fixture(); f.store.close(); downgradeFixture(f.filename);
  const db = new Database(f.filename); db.exec("CREATE TRIGGER reject_migration BEFORE INSERT ON schema_migrations WHEN NEW.version=2 BEGIN SELECT RAISE(ABORT, 'test'); END;");
  expect(() => initializeSchema(db, now)).toThrow();
  expect(db.pragma('user_version', { simple: true })).toBe(1);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'memory_%'").all()).toEqual([]);
  expect(db.prepare('PRAGMA table_info(messages)').all().map(row => (row as { name: string }).name)).not.toContain('memory_confirmable');
  db.exec('DROP TRIGGER reject_migration; PRAGMA user_version=99;'); db.close();
  expect(() => SqliteMemoryStore.open(f.filename, now)).toThrow('unsupported_version');
});
