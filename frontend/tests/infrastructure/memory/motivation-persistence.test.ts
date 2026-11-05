import { dropLifeHistory } from './schema-fixture';
import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import { initializeSchema } from '../../../src/infrastructure/memory/schema';
import { evaluateOwnGoals, initialMotivation } from '../../../src/domain/character/own-goals';
import { motivationRecord } from '../../../src/infrastructure/memory/motivation-validation';
import type { Operation } from '../../../src/infrastructure/memory/protocol';

const now = '2026-11-05T10:00:00.000Z';
const stores: SqliteMemoryStore[] = [], dirs: string[] = [];
function open(file: string) { const store = SqliteMemoryStore.open(file, now); stores.push(store); return store; }
function fixture() { const dir = mkdtempSync(path.join(os.tmpdir(), 'wisp-goals-db-')); dirs.push(dir); const file = path.join(dir, 'memory.db'); return { file, store: open(file) }; }
function run(store: SqliteMemoryStore, operation: Operation, payload: unknown, generation = 0) { return store.execute({ id: 1, operation, payload, generation }); }
function goals() { let n = 0; return evaluateOwnGoals(initialMotivation(now), { energy: 35, boredom: 65 }, now, () => `goal-${++n}`); }
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it('migrates populated v9 atomically, preserves pending goals after restart and restores no Activity route', () => {
  const f = fixture();
  expect(run(f.store, 'upsertFact', { id: 'f', factKey: 'name', factValue: 'Synthetic', confidence: 1, sourceMessageId: null, createdAt: now, updatedAt: now }).ok).toBe(true);
  f.store.close(); const db = new Database(f.file);
  dropLifeHistory(db);
  db.exec("DROP TABLE own_motivation; DELETE FROM schema_migrations WHERE version=10; PRAGMA user_version=9; CREATE TRIGGER reject_v10 BEFORE INSERT ON schema_migrations WHEN NEW.version=10 BEGIN SELECT RAISE(ABORT,'test'); END;");
  expect(() => initializeSchema(db, now)).toThrow();
  expect(db.pragma('user_version', { simple: true })).toBe(9);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='own_motivation'").all()).toEqual([]);
  expect(db.prepare('SELECT fact_value FROM user_facts').get()).toEqual({ fact_value: 'Synthetic' });
  db.exec('DROP TRIGGER reject_v10'); db.close();
  const restored = open(f.file), value = goals();
  expect(run(restored, 'replaceMotivation', { value, expectedRevision: null }).ok).toBe(true);
  restored.close(); const restarted = open(f.file);
  const result = run(restarted, 'readMotivation', '2026-11-05T10:00:01.000Z');
  expect(result.ok).toBe(true);
  if (result.ok) expect(motivationRecord(result.value)).toMatchObject({ goals: value.goals, plan: null });
  expect(run(restarted, 'readMotivation', '2026-11-05T10:10:00.000Z')).toMatchObject({ ok: true, value: { goals: [{ status: 'expired' }, { status: 'expired' }] } });
});
it('clears motivation in the shared reset transaction and retains the generation barrier after rollback', () => {
  const f = fixture();
  expect(run(f.store, 'replaceMotivation', { value: goals(), expectedRevision: null }).ok).toBe(true);
  const db = new Database(f.file); db.exec("CREATE TRIGGER prevent_goal_clear BEFORE DELETE ON own_motivation BEGIN SELECT RAISE(ABORT,'test'); END;");
  expect(run(f.store, 'clear', null, 1)).toEqual({ ok: false, code: 'conflict' });
  expect(run(f.store, 'readMotivation', now)).toEqual({ ok: false, code: 'stale' });
  expect(run(f.store, 'readMotivation', now, 1)).toMatchObject({ ok: true, value: { goals: [{ status: 'pending' }, { status: 'pending' }] } });
  db.exec('DROP TRIGGER prevent_goal_clear'); db.close();
  expect(run(f.store, 'clear', null, 2).ok).toBe(true);
  expect(run(f.store, 'readMotivation', now, 2)).toEqual({ ok: true, value: null });
  expect(run(f.store, 'replaceMotivation', { value: goals(), expectedRevision: null }, 1)).toEqual({ ok: false, code: 'stale' });
});
