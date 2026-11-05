import { LIFE_DERIVED_SCHEMA } from './life-derived-turn-store';
import { DEFERRED_INVITATION_SCHEMA } from './deferred-invitation-store';
import { SOCIAL_INTERPRETATION_SCHEMA } from './social-interpretation-store';
import { MOTIVATION_SCHEMA } from './motivation-store';
import { CAUSAL_LIFE_SCHEMA } from './causal-life-store';
import { LifeHistoryStore } from './life-history-store';
import { CausalRecallStore } from './causal-recall-store';
import { MemoryItemRecallStore } from './item-recall-store';
import { migrateRoutine, ROUTINE_TABLES } from './routine-schema';
import { migrateBeverage } from './beverage-schema';
import { INTEREST_THREAD_SCHEMA, INTEREST_THREAD_TABLES } from './interest-thread-schema';
import { MEMORY_ITEMS_SCHEMA, MEMORY_ITEM_TABLES } from './item-schema';
import type Database from 'better-sqlite3';
import { MemoryDataError, record, timestamp } from './validation';

export const SCHEMA_VERSION = 11;
const migrationName = 'local_memory_v1';
const migrationNames = [migrationName, 'confirmed_memory_items_v2', 'interest_thread_v3', 'beverage_preference_v4', 'routine_observations_v5', 'causal_life_v6', 'causal_recall_v7', 'deferred_game_invitation_v8', 'social_interpretation_v9', 'own_motivation_v10', 'causal_history_v11'];
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
    if (version >= 2 && MEMORY_ITEM_TABLES.some(name => name !== 'memory_item_terms' && !names.includes(name))) throw new MemoryDataError('corrupt');
    if (version >= 3 && INTEREST_THREAD_TABLES.some(name => !names.includes(name))) throw new MemoryDataError('corrupt');
    if (version >= 5 && ROUTINE_TABLES.some(name => !names.includes(name))) throw new MemoryDataError('corrupt');
    if (version >= 6 && !names.includes('causal_life_episodes')) throw new MemoryDataError('corrupt');
    if (version >= 8 && ['deferred_game_invitation','deferred_invitation_sources'].some(name => !names.includes(name))) throw new MemoryDataError('corrupt');
    if (version >= 11 && !names.includes('life_derived_turns')) throw new MemoryDataError('corrupt');
    if (version >= 10 && !names.includes('own_motivation')) throw new MemoryDataError('corrupt');
    const entries = db.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version').all();
    if (entries.length !== version) throw new MemoryDataError('corrupt');
    for (const [index, entry] of entries.entries()) {
      const row = record(entry);
      if (row.version !== index + 1 || row.name !== migrationNames[index]) throw new MemoryDataError('corrupt');
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
  if (version < 2) db.transaction(() => {
    db.exec(MEMORY_ITEMS_SCHEMA);
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(2, migrationNames[1], now);
    db.pragma('user_version = 2');
  }).immediate();
  if (version < 3) db.transaction(() => {
    db.exec(INTEREST_THREAD_SCHEMA);
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(3, migrationNames[2], now);
    db.pragma('user_version = 3');
  }).immediate();
  if (version < 4) migrateBeverage(db, now);
  if (version < 5) migrateRoutine(db, now);
  if (version < 6) db.transaction(() => {
    db.exec(CAUSAL_LIFE_SCHEMA);
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(6, migrationNames[5], now);
    db.pragma('user_version = 6');
  }).immediate();
  db.transaction(() => {
    new CausalRecallStore(db).ensure();
    new MemoryItemRecallStore(db).ensure();
    if (version < 7) {
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(7, migrationNames[6], now);
      db.pragma('user_version = 7');
    }
  }).immediate();
  if (version < 8) db.transaction(() => {
    db.exec(DEFERRED_INVITATION_SCHEMA);
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(8, migrationNames[7], now);
    db.pragma('user_version = 8');
  }).immediate();
  if (version < 9) db.transaction(() => {
    db.exec(SOCIAL_INTERPRETATION_SCHEMA);
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(9, migrationNames[8], now);
    db.pragma('user_version = 9');
  }).immediate();
  if (version < 10) db.transaction(() => {
    db.exec(MOTIVATION_SCHEMA);
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(10, migrationNames[9], now);
    db.pragma('user_version = 10');
  }).immediate();
  db.transaction(() => {
    new LifeHistoryStore(db).ensure();
    db.exec(LIFE_DERIVED_SCHEMA);
    if (version < 11) {
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(11, migrationNames[10], now);
      db.pragma('user_version = 11');
    }
  }).immediate();
  const foreignKeyErrors: unknown = db.pragma('foreign_key_check');
  if (!Array.isArray(foreignKeyErrors) || foreignKeyErrors.length !== 0) throw new MemoryDataError('corrupt');
}
