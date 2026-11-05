import type Database from 'better-sqlite3';
import type { CausalLifeEpisode } from '../../application/ports/causal-life.interface';
import type { LifeHistoryWindow } from '../../application/ports/life-history.interface';
import { causalEpisode } from './causal-life-validation';
import { lifeWindowQuery } from './life-history-validation';
import { integer, MemoryDataError, record, text } from './validation-primitives';

const schema = `
CREATE TABLE IF NOT EXISTS causal_history_index (app_run_id TEXT NOT NULL,sequence INTEGER NOT NULL,occurred_at TEXT NOT NULL,insertion_order INTEGER NOT NULL,payload_bytes INTEGER NOT NULL,PRIMARY KEY(app_run_id,sequence),FOREIGN KEY(app_run_id,sequence) REFERENCES causal_life_episodes(app_run_id,sequence) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS causal_history_window ON causal_history_index(occurred_at,insertion_order,app_run_id,sequence);
CREATE TABLE IF NOT EXISTS causal_history_build (id INTEGER PRIMARY KEY CHECK(id=1),cursor INTEGER NOT NULL,target INTEGER NOT NULL,complete INTEGER NOT NULL,last_clock TEXT);
`;
/** A disposable time index. Canonical rows remain the only source of facts. */
export class LifeHistoryStore {
  constructor(private readonly db: Database.Database) {}
  ensure(): void {
    const present = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='causal_history_index'").get() !== undefined;
    this.db.exec(schema);
    if (!present) this.db.prepare('DELETE FROM causal_history_build').run();
    const target = integer(record(this.db.prepare('SELECT coalesce(max(rowid),0) AS target FROM causal_life_episodes').get()).target);
    this.db.prepare('INSERT OR IGNORE INTO causal_history_build VALUES(1,0,?,?,NULL)').run(target, target === 0 ? 1 : 0);
  }
  index(episode: CausalLifeEpisode, order: number): void {
    if (episode.activity !== 'cursor_game') return;
    this.db.prepare('INSERT OR REPLACE INTO causal_history_index VALUES(?,?,?,?,?)').run(episode.appRunId, episode.sequence, episode.occurredAt, order, Buffer.byteLength(JSON.stringify(episode), 'utf8'));
  }
  maintain(): void {
    this.ensure();
    this.db.transaction(() => {
      const state = record(this.db.prepare('SELECT cursor,target,complete FROM causal_history_build WHERE id=1').get());
      if (state.complete === 1) return;
      const target = integer(state.target), cursor = integer(state.cursor);
      const rows = this.db.prepare('SELECT rowid AS ordinal,payload FROM causal_life_episodes WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT 64').all(cursor, target);
      let next = cursor;
      for (const row of rows) {
        const r = record(row); next = integer(r.ordinal, 1);
        try { this.index(causalEpisode(JSON.parse(text(r.payload, 4096))), next); } catch (error) {
          if (!(error instanceof MemoryDataError) && !(error instanceof SyntaxError)) throw error;
          this.db.prepare('UPDATE causal_history_build SET complete=-1 WHERE id=1').run(); return;
        }
      }
      this.db.prepare('UPDATE causal_history_build SET cursor=?,complete=? WHERE id=1').run(next, rows.length < 64 || next >= target ? 1 : 0);
    }).immediate();
  }
  read(value: unknown): LifeHistoryWindow {
    const q = lifeWindowQuery(value);
    this.ensure();
    return this.db.transaction((): LifeHistoryWindow => {
      let examined = 0, fetched = 0;
      const omit = (coverage: LifeHistoryWindow['coverage']): LifeHistoryWindow => ({ coverage, events: [], examined, fetched });
      const state = record(this.db.prepare('SELECT complete,last_clock FROM causal_history_build WHERE id=1').get());
      const previous = state.last_clock === null ? null : text(state.last_clock);
      // This indexed maximum automatically follows deletion of the latest source.
      const latest = this.db.prepare('SELECT occurred_at FROM causal_history_index ORDER BY occurred_at DESC LIMIT 1').get();
      if (previous !== null && previous > q.asOf) return omit('clock_unknown');
      this.db.prepare('UPDATE causal_history_build SET last_clock=? WHERE id=1').run(q.asOf);
      if (state.complete === -1 || (latest !== undefined && text(record(latest).occurred_at) > q.asOf)) return omit('clock_unknown');
      if (state.complete !== 1) return omit('index_building');
      const rows = this.db.prepare('SELECT * FROM causal_history_index WHERE occurred_at>=? AND occurred_at<=? ORDER BY occurred_at,insertion_order,app_run_id COLLATE BINARY,sequence LIMIT 1001').all(`${q.fromDateUTC}T00:00:00.000Z`, q.asOf.slice(0, 10) === q.throughDateUTC ? q.asOf : `${q.throughDateUTC}T23:59:59.999Z`);
      examined = rows.length;
      if (examined > 1000) return omit('overflow');
      const bytes = rows.reduce<number>((sum, row) => sum + integer(record(row).payload_bytes, 1), 0);
      if (bytes > 1024 * 1024) return omit('overflow');
      const events: CausalLifeEpisode[] = [], runs = new Set<string>();
      const exact = this.db.prepare('SELECT rowid AS ordinal,payload FROM causal_life_episodes WHERE app_run_id=? AND sequence=?');
      for (const row of rows) {
        const r = record(row), found = exact.get(text(r.app_run_id), integer(r.sequence, 1)); fetched++;
        if (found === undefined) return omit('clock_unknown');
        try {
          const source = record(found), raw = text(source.payload, 4096), episode = causalEpisode(JSON.parse(raw));
          const run = JSON.stringify([episode.appRunId, episode.activityRunId]);
          if (episode.activity !== 'cursor_game' || episode.appRunId !== r.app_run_id || episode.sequence !== r.sequence || episode.occurredAt !== r.occurred_at || source.ordinal !== r.insertion_order || Buffer.byteLength(raw, 'utf8') !== r.payload_bytes || runs.has(run)) return omit('clock_unknown');
          runs.add(run); events.push(episode);
        } catch (error) {
          if (!(error instanceof MemoryDataError) && !(error instanceof SyntaxError)) throw error;
          return omit('clock_unknown');
        }
      }
      if (Buffer.byteLength(JSON.stringify(events), 'utf8') > 1024 * 1024) return omit('overflow');
      return { coverage: 'complete', events, examined, fetched };
    }).immediate();
  }
  clear(): void { this.db.exec('DELETE FROM causal_history_index; DELETE FROM causal_history_build; INSERT INTO causal_history_build VALUES(1,0,0,1,NULL);'); }
}
