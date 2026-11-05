import { SCHEMA_VERSION } from '../../../src/infrastructure/memory/schema';
import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeSchema } from '../../../src/infrastructure/memory/schema';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import { dropSocialInterpretation } from './schema-fixture';

const now = '2026-11-05T10:00:00.000Z', directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
it('additively migrates a populated v8 with atomic schema/journal/trigger rollback', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wisp-interpretation-migration-')); directories.push(directory);
  const filename = path.join(directory, 'memory.db'), db = new Database(filename);
  initializeSchema(db, now); dropSocialInterpretation(db); db.pragma('user_version=8');
  db.prepare('INSERT INTO user_facts VALUES (?,?,?,?,?,?,?)').run('fact', 'user.display_name', 'Test', 1, null, now, now);
  db.exec("CREATE TRIGGER reject_v9 BEFORE INSERT ON schema_migrations WHEN NEW.version=9 BEGIN SELECT RAISE(ABORT,'test'); END;");
  expect(() => initializeSchema(db, now)).toThrow(); expect(db.pragma('user_version', { simple: true })).toBe(8);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'social_%'").all()).toEqual([]);
  expect(db.prepare('SELECT fact_value FROM user_facts').get()).toEqual({ fact_value: 'Test' });
  db.exec('DROP TRIGGER reject_v9'); initializeSchema(db, now);
  expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  expect(db.prepare("SELECT name FROM schema_migrations WHERE version=9").get()).toEqual({ name: 'social_interpretation_v9' });
  expect(db.pragma('foreign_key_check')).toEqual([]); db.close();
  const store = SqliteMemoryStore.open(filename, now);
  try {
    expect(store.execute({ id: 1, generation: 0, operation: 'readSocialInterpretation', payload: now })).toEqual({ ok: true, value: null });
    expect(store.execute({ id: 2, generation: 0, operation: 'readSocialInterpretation', payload: { now } })).toEqual({ ok: false, code: 'invalid_data' });
  } finally { store.close(); }
});
