import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeSchema, SCHEMA_VERSION } from '../../../src/infrastructure/memory/schema';
import { restoreLegacyPreferenceColumns } from './schema-fixture';

const now = '2026-11-06T00:00:00.000Z';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function legacy() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wisp-retire-preference-')); dirs.push(dir);
  const filename = path.join(dir, 'memory.db');
  const db = new Database(filename); initializeSchema(db, now);
  restoreLegacyPreferenceColumns(db);
  db.pragma('user_version=13');
  db.prepare('INSERT INTO conversation_sessions VALUES(?,?,?,NULL)').run('session', 'app', now);
  const message = db.prepare('INSERT INTO messages(id,conversation_session_id,role,content,created_at,memory_confirmable) VALUES(?,?,?,?,?,1)');
  for (const [id, role, content] of [['event-u','user','Наш важный день'],['event-a','assistant','Запомнила'],
    ['drink-u','user','Я пью кофе'],['drink-a','assistant','Возможно, ты любишь кофе'],
    ['consumer-u','user','Расскажи про космос'],['consumer-a','assistant','Обсудили космос'],
    ['correct-u','user','Нет, предпочитаю чай'],['correct-a','assistant','Учту исправление']]) {
    message.run(id, 'session', role, content, now);
  }
  db.prepare(`INSERT INTO memory_items(insertion_order,id,revision,status,category,label,text,confirmed_at,command_id,source_user_id,source_assistant_id)
    VALUES(7,'event',1,'active','important_event','День','Наш важный день',?,'event-command','event-u','event-a')`).run(now);
  db.prepare(`INSERT INTO memory_items(insertion_order,id,revision,status,category,label,text,confirmed_at,command_id,source_user_id,source_assistant_id,
    beverage_value,beverage_provenance,beverage_validity,beverage_manually_corrected)
    VALUES(100,'drink',2,'active','beverage_preference','beverage_preference','tea',?,'drink-command','correct-u','correct-a','tea','user_statement','confirmed',1)`).run(now);
  db.exec(`INSERT INTO memory_item_sources VALUES('event','event-u','event-a'),('drink','drink-u','drink-a'),('drink','correct-u','correct-a');
    INSERT INTO memory_item_terms VALUES('день','event',7),('coffee','drink',100);
    INSERT INTO memory_suppressed_pairs VALUES('event-u','event-a'),('drink-u','drink-a'),('consumer-u','consumer-a');
    INSERT INTO memory_mutation_receipts(rowid,command_id,kind,item_id,revision,outcome,digest)
      VALUES(5,'event-command','confirm','event',1,'active','event-digest');
    INSERT INTO memory_mutation_receipts(command_id,kind,item_id,revision,outcome,digest,request_id,user_message_id,assistant_message_id)
      VALUES('drink-command','beverage_correct','drink',2,'confirmed','drink-digest',NULL,NULL,NULL),
        ('consumer','beverage_turn','drink',1,'hypothesis','consumer-digest','request','consumer-u','consumer-a');`);
  return { db, filename };
}
it('removes the dedicated rows and schema while retaining unrelated memory, transcript, ordering and source suppression across restart', () => {
  const { db, filename } = legacy();
  const messages = db.prepare('SELECT * FROM messages ORDER BY sequence').all();
  const ordinaryItem = db.prepare("SELECT insertion_order,id,revision,status,category,label,text,occurred_on,confirmed_at,command_id,source_user_id,source_assistant_id FROM memory_items WHERE id='event'").get();
  initializeSchema(db, now);
  expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  expect(db.prepare('SELECT * FROM messages ORDER BY sequence').all()).toEqual(messages);
  expect(db.prepare('SELECT * FROM memory_items').all()).toEqual([ordinaryItem]);
  expect(db.prepare('SELECT * FROM memory_item_sources').all()).toEqual([{ item_id: 'event', user_message_id: 'event-u', assistant_message_id: 'event-a' }]);
  expect(db.prepare('SELECT * FROM memory_item_terms').all()).toEqual([{ token: 'день', item_id: 'event', insertion_order: 7 }]);
  expect(db.prepare('SELECT rowid,* FROM memory_mutation_receipts').all()).toEqual([{ rowid: 5, command_id: 'event-command', kind: 'confirm', item_id: 'event', revision: 1, outcome: 'active', digest: 'event-digest' }]);
  expect(db.prepare('SELECT * FROM memory_suppressed_pairs ORDER BY user_message_id').all()).toEqual([
    { user_message_id: 'consumer-u', assistant_message_id: 'consumer-a' },
    { user_message_id: 'correct-u', assistant_message_id: 'correct-a' },
    { user_message_id: 'drink-u', assistant_message_id: 'drink-a' },
    { user_message_id: 'event-u', assistant_message_id: 'event-a' },
  ]);
  expect(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='memory_items'").get()).toEqual({ seq: 100 });
  expect(() => db.prepare(`INSERT INTO memory_items(id,revision,status,category,label,text,confirmed_at,command_id,source_user_id,source_assistant_id)
    VALUES('new',1,'active','beverage_preference','drink','coffee',?,'new-command','drink-u','drink-a')`).run(now)).toThrow();
  expect(db.pragma('foreign_key_check')).toEqual([]); db.close();
  const reopened = new Database(filename);
  try { initializeSchema(reopened, now); expect(reopened.prepare('SELECT id FROM memory_items').all()).toEqual([{ id: 'event' }]); }
  finally { reopened.close(); }
});
it('rolls cleanup DDL, rows, suppression and migration journal back together on failure', () => {
  const { db } = legacy();
  try {
    const tables = ['memory_items','memory_item_sources','memory_item_terms','memory_mutation_receipts','memory_suppressed_pairs','messages'];
    const before = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
    db.exec("CREATE TRIGGER reject_retirement BEFORE INSERT ON schema_migrations WHEN NEW.version=14 BEGIN SELECT RAISE(ABORT,'retirement fault'); END;");
    expect(() => initializeSchema(db, now)).toThrow('retirement fault');
    expect(db.pragma('user_version', { simple: true })).toBe(13);
    for (const [i, table] of tables.entries()) expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual(before[i]);
    expect(db.prepare("SELECT name FROM sqlite_temp_master WHERE name LIKE 'retired_preference_%'").all()).toEqual([]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    db.exec('DROP TRIGGER reject_retirement'); initializeSchema(db, now);
    expect(db.prepare("SELECT name FROM schema_migrations WHERE version=14").get()).toEqual({ name: 'remove_beverage_preference_v14' });
  } finally { db.close(); }
});
