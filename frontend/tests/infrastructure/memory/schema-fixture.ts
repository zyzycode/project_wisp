import type Database from 'better-sqlite3';
import { MEMORY_ITEMS_SCHEMA } from '../../../src/infrastructure/memory/item-schema';
/** Test fixture downgrade of an empty schema5 card store, before populating migration3 data. */
export function schema3(db:Database.Database):void {
 db.exec(`DROP TABLE IF EXISTS routine_observations; DROP TABLE IF EXISTS routine_metadata; DELETE FROM schema_migrations WHERE version=5;
 DROP TABLE memory_item_terms;DROP TABLE memory_item_sources;DROP TABLE memory_items;
 DROP INDEX beverage_turn_request;DROP INDEX beverage_turn_user;DROP INDEX beverage_turn_assistant;
 ALTER TABLE memory_mutation_receipts DROP COLUMN request_id;
 ALTER TABLE memory_mutation_receipts DROP COLUMN user_message_id;
 ALTER TABLE memory_mutation_receipts DROP COLUMN assistant_message_id;
 DELETE FROM schema_migrations WHERE version=4; PRAGMA user_version=3;`);
 const tables=MEMORY_ITEMS_SCHEMA.slice(MEMORY_ITEMS_SCHEMA.indexOf('CREATE TABLE memory_items'),MEMORY_ITEMS_SCHEMA.indexOf('CREATE TABLE memory_suppressed_pairs'));
 db.exec(tables);
}
