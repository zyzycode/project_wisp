import type Database from 'better-sqlite3';
import { MemoryDataError, record, timestamp } from './validation';

export const SCHEMA_VERSION = 1;
const migrationName = 'local_memory_v1';
const schema = `
CREATE TABLE conversation_sessions (id TEXT PRIMARY KEY NOT NULL, app_run_id TEXT NOT NULL UNIQUE, started_at TEXT NOT NULL, ended_at TEXT);
CREATE TABLE messages (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, conversation_session_id TEXT NOT NULL REFERENCES conversation_sessions(id) ON DELETE RESTRICT, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX messages_session_sequence ON messages(conversation_session_id, sequence);
CREATE TABLE user_facts (id TEXT PRIMARY KEY NOT NULL, fact_key TEXT NOT NULL UNIQUE, fact_value TEXT NOT NULL, confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1), source_message_id TEXT REFERENCES messages(id) ON DELETE RESTRICT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE game_episodes (app_run_id TEXT NOT NULL, activity_run_id TEXT NOT NULL, kind TEXT NOT NULL, outcome TEXT NOT NULL, play_completed INTEGER NOT NULL CHECK(play_completed = 1), executed_ms REAL NOT NULL CHECK(executed_ms >= 0), ended_at TEXT NOT NULL, PRIMARY KEY(app_run_id, activity_run_id));
CREATE TABLE character_state (id TEXT PRIMARY KEY NOT NULL CHECK(id = 'singleton'), snapshot_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY CHECK(version > 0), name TEXT NOT NULL, applied_at TEXT NOT NULL);
`;
export function initializeSchema(db: Database.Database, now: string): void {
  timestamp(now);
  if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new MemoryDataError('corrupt');
  const version: unknown = db.pragma('user_version', { simple: true });
  if (typeof version !== 'number' || version < 0) throw new MemoryDataError('corrupt');
  if (version > SCHEMA_VERSION) throw new MemoryDataError('unsupported_version');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  if (version === 0) {
    if (tables.length !== 0) throw new MemoryDataError('corrupt');
  } else {
    const names = tables.map(row => record(row).name);
    if (['conversation_sessions', 'messages', 'user_facts', 'game_episodes', 'character_state', 'schema_migrations'].some(name => !names.includes(name))) throw new MemoryDataError('corrupt');
    const entries = db.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version').all();
    if (entries.length !== version) throw new MemoryDataError('corrupt');
    for (const [index, entry] of entries.entries()) {
      const row = record(entry);
      if (row.version !== index + 1 || row.name !== migrationName) throw new MemoryDataError('corrupt');
      timestamp(row.applied_at);
    }
  }
  db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000'); db.pragma('trusted_schema = OFF');
  if (db.pragma('journal_mode = WAL', { simple: true }) !== 'wal') throw new MemoryDataError('unavailable');
  db.pragma('synchronous = FULL');
  for (const [name, expected] of [['foreign_keys', 1], ['busy_timeout', 5000], ['trusted_schema', 0], ['synchronous', 2]] as const) {
    if (db.pragma(name, { simple: true }) !== expected) throw new MemoryDataError('unavailable');
  }
  if (version === 0) db.transaction(() => {
    db.exec(schema);
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(1, migrationName, now);
    db.pragma('user_version = 1');
  }).immediate();
  const foreignKeyErrors: unknown = db.pragma('foreign_key_check');
  if (!Array.isArray(foreignKeyErrors) || foreignKeyErrors.length !== 0) throw new MemoryDataError('corrupt');
}
