import type Database from 'better-sqlite3';
import { MEMORY_ITEMS_SCHEMA } from './item-schema';
import { integer, record } from './validation-primitives';

/** Retire the dedicated preference without reviving its historical source/consumer pairs. */
export function removeBeveragePreferences(db: Database.Database, now: string): void {
  db.transaction(() => {
    const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name='memory_items'").get();
    db.exec(`INSERT OR IGNORE INTO memory_suppressed_pairs
      SELECT source_user_id,source_assistant_id FROM memory_items WHERE category='beverage_preference';
      INSERT OR IGNORE INTO memory_suppressed_pairs
      SELECT user_message_id,assistant_message_id FROM memory_item_sources
      WHERE item_id IN (SELECT id FROM memory_items WHERE category='beverage_preference');
      INSERT OR IGNORE INTO memory_suppressed_pairs
      SELECT user_message_id,assistant_message_id FROM memory_mutation_receipts
      WHERE substr(kind,1,9)='beverage_' AND user_message_id IS NOT NULL AND assistant_message_id IS NOT NULL;
      DELETE FROM memory_items WHERE category='beverage_preference';
      DELETE FROM memory_mutation_receipts WHERE substr(kind,1,9)='beverage_';
      CREATE TEMP TABLE retired_preference_sources AS SELECT * FROM memory_item_sources;
      CREATE TEMP TABLE retired_preference_terms AS SELECT * FROM memory_item_terms;
      DROP TABLE memory_item_terms;
      DROP TABLE memory_item_sources;`);
    const parentStart = MEMORY_ITEMS_SCHEMA.indexOf('CREATE TABLE memory_items');
    const childrenStart = MEMORY_ITEMS_SCHEMA.indexOf('CREATE TABLE memory_item_sources');
    const childrenEnd = MEMORY_ITEMS_SCHEMA.indexOf('CREATE TABLE memory_suppressed_pairs');
    db.exec(MEMORY_ITEMS_SCHEMA.slice(parentStart, childrenStart).replace('CREATE TABLE memory_items', 'CREATE TABLE memory_items_without_preference'));
    db.exec(`INSERT INTO memory_items_without_preference
      SELECT insertion_order,id,revision,status,category,label,text,occurred_on,confirmed_at,command_id,source_user_id,source_assistant_id FROM memory_items;
      DROP TABLE memory_items;
      ALTER TABLE memory_items_without_preference RENAME TO memory_items;`);
    db.exec(MEMORY_ITEMS_SCHEMA.slice(childrenStart, childrenEnd));
    db.exec(`INSERT INTO memory_item_sources SELECT * FROM retired_preference_sources;
      INSERT INTO memory_item_terms SELECT * FROM retired_preference_terms;
      CREATE INDEX memory_sources_user ON memory_item_sources(user_message_id,item_id);
      CREATE INDEX memory_sources_assistant ON memory_item_sources(assistant_message_id,item_id);
      DROP TABLE retired_preference_sources;
      DROP TABLE retired_preference_terms;
      DROP INDEX beverage_turn_request;
      DROP INDEX beverage_turn_user;
      DROP INDEX beverage_turn_assistant;
      ALTER TABLE memory_mutation_receipts DROP COLUMN request_id;
      ALTER TABLE memory_mutation_receipts DROP COLUMN user_message_id;
      ALTER TABLE memory_mutation_receipts DROP COLUMN assistant_message_id;`);
    if (sequence) {
      const highWater = integer(record(sequence).seq);
      const updated = db.prepare("UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name='memory_items'").run(highWater);
      if (updated.changes === 0) db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES('memory_items',?)").run(highWater);
    }
    const errors: unknown = db.pragma('foreign_key_check');
    if (!Array.isArray(errors) || errors.length) throw new Error('Retired preference migration failed');
    db.prepare('INSERT INTO schema_migrations VALUES(14,?,?)').run('remove_beverage_preference_v14', now);
    db.pragma('user_version = 14');
  }).immediate();
}
