import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
export const ROUTINE_TABLES = ['routine_metadata', 'routine_observations'];
export function migrateRoutine(db: Database.Database, now: string): void {
  db.transaction(() => {
    db.exec(`CREATE TABLE routine_metadata (id TEXT PRIMARY KEY CHECK(id='singleton'), dataset_epoch TEXT NOT NULL, cohort_id TEXT NOT NULL, zone_id TEXT, offset_minutes INTEGER);
      CREATE TABLE routine_observations (receipt INTEGER PRIMARY KEY, app_run_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence>0), dataset_epoch TEXT NOT NULL, cohort_id TEXT NOT NULL, start_utc_ms INTEGER NOT NULL, end_utc_ms INTEGER NOT NULL, zone_id TEXT NOT NULL, offset_minutes INTEGER NOT NULL, local_date TEXT NOT NULL, tuning_id TEXT NOT NULL, active_ms INTEGER NOT NULL, inactive_ms INTEGER NOT NULL, away_ms INTEGER NOT NULL, unknown_ms INTEGER NOT NULL, UNIQUE(app_run_id,sequence));
      CREATE INDEX routine_cohort_start ON routine_observations(cohort_id,start_utc_ms);
      CREATE INDEX routine_cohort_end ON routine_observations(cohort_id,end_utc_ms);
      CREATE INDEX routine_cohort_date ON routine_observations(cohort_id,local_date);`);
    db.prepare("INSERT INTO routine_metadata VALUES ('singleton', ?, ?, NULL, NULL)").run(randomUUID(), randomUUID());
    db.prepare('INSERT INTO schema_migrations VALUES (5, ?, ?)').run('routine_observations_v5', now);
    db.pragma('user_version = 5');
  }).immediate();
}
