import { migrateBeverage } from '../../../src/infrastructure/memory/beverage-schema';
import type Database from 'better-sqlite3';
import { MEMORY_ITEMS_SCHEMA } from '../../../src/infrastructure/memory/item-schema';
/** Test fixture downgrade of an empty current schema card store, before populating migration3 data. */
export function schema3(db:Database.Database):void {
 dropSocialInterpretation(db);
 db.exec(`DROP TABLE IF EXISTS deferred_game_invitation; DROP TABLE IF EXISTS deferred_invitation_sources; DELETE FROM schema_migrations WHERE version=8; DROP TABLE IF EXISTS causal_recall_postings; DROP TABLE IF EXISTS causal_recall_build; DROP TABLE IF EXISTS memory_item_recall_build; DELETE FROM schema_migrations WHERE version=7; DROP TABLE IF EXISTS causal_life_episodes; DELETE FROM schema_migrations WHERE version=6; DROP TABLE IF EXISTS routine_observations; DROP TABLE IF EXISTS routine_metadata; DELETE FROM schema_migrations WHERE version=5;
 DROP TABLE memory_item_terms;DROP TABLE memory_item_sources;DROP TABLE memory_items;
 DROP INDEX beverage_turn_request;DROP INDEX beverage_turn_user;DROP INDEX beverage_turn_assistant;
 ALTER TABLE memory_mutation_receipts DROP COLUMN request_id;
 ALTER TABLE memory_mutation_receipts DROP COLUMN user_message_id;
 ALTER TABLE memory_mutation_receipts DROP COLUMN assistant_message_id;
 DELETE FROM schema_migrations WHERE version=4; PRAGMA user_version=3;`);
 const tables=MEMORY_ITEMS_SCHEMA.slice(MEMORY_ITEMS_SCHEMA.indexOf('CREATE TABLE memory_items'),MEMORY_ITEMS_SCHEMA.indexOf('CREATE TABLE memory_suppressed_pairs'));
 db.exec(tables);
}

/** Remove only the additive v9 feature before a fixture exercises an older migration. */
export function dropSocialInterpretation(db: Database.Database): void {
 dropLifeHistory(db);
 db.exec('DROP TABLE IF EXISTS own_motivation; DELETE FROM schema_migrations WHERE version=10;');
 db.exec(`DROP TRIGGER IF EXISTS social_report_deleted; DROP TRIGGER IF EXISTS social_report_corrected;
 DROP TRIGGER IF EXISTS social_session_corrected; DROP TRIGGER IF EXISTS social_episode_corrected;
 DROP TABLE IF EXISTS social_interpretation_reports; DROP TABLE IF EXISTS social_interpretation;
 DELETE FROM schema_migrations WHERE version=9;`);
}

/** Remove v11 derived tables when constructing a genuine older schema. */
export function dropLifeHistory(db: Database.Database): void {
 dropAfterLifeHistory(db);
 db.exec('DROP TABLE IF EXISTS causal_history_index; DROP TABLE IF EXISTS causal_history_build; DROP TABLE IF EXISTS life_derived_turns; DELETE FROM schema_migrations WHERE version=11;');
}

/** Remove post-v11 feature metadata before constructing an older schema fixture. */
export function dropAfterLifeHistory(db: Database.Database): void {
 restoreLegacyPreferenceColumns(db);
 db.exec('DELETE FROM schema_migrations WHERE version>=12;');
}

/** Restore the historical parent shape before downgrading a test database to v4–v13. */
export function restoreLegacyPreferenceColumns(db: Database.Database): void {
 db.exec('DELETE FROM schema_migrations WHERE version>=14;');
 const columns = db.prepare('PRAGMA table_info(memory_items)').all();
 if (columns.some(row => typeof row === 'object' && row !== null && 'name' in row && row.name === 'beverage_value')) return;
 const version = db.pragma('user_version', { simple: true });
 const migration = db.prepare('SELECT applied_at FROM schema_migrations WHERE version=4').get() as { applied_at: string };
 db.exec('DELETE FROM schema_migrations WHERE version=4;');
 migrateBeverage(db, migration.applied_at);
 db.pragma(`user_version = ${Number(version)}`);
}
