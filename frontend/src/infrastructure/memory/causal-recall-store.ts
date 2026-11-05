import type Database from 'better-sqlite3';
import type { CausalLifeEpisode } from '../../application/ports/causal-life.interface';
import type { CausalRecallPage } from '../../application/ports/causal-recall.interface';
import { causalRecallBuckets } from '../../domain/character/causal-recall';
import { causalEpisode } from './causal-life-validation';
import { causalRecallKey, causalRecallQuery } from './causal-recall-validation';
import { integer, MemoryDataError, record, text } from './validation-primitives';

export const CAUSAL_RECALL_SCHEMA = `
CREATE TABLE IF NOT EXISTS causal_recall_postings (key TEXT NOT NULL, app_run_id TEXT NOT NULL, sequence INTEGER NOT NULL, insertion_order INTEGER NOT NULL, PRIMARY KEY(key,app_run_id,sequence), FOREIGN KEY(app_run_id,sequence) REFERENCES causal_life_episodes(app_run_id,sequence) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS causal_recall_lookup ON causal_recall_postings(key,insertion_order DESC,app_run_id,sequence);
CREATE TABLE IF NOT EXISTS causal_recall_build (id INTEGER PRIMARY KEY CHECK(id=1), cursor INTEGER NOT NULL, target INTEGER NOT NULL, complete INTEGER NOT NULL CHECK(complete IN(0,1)));
`;
function payload(value: unknown): CausalLifeEpisode { return causalEpisode(JSON.parse(text(value, 4096))); }
function eligiblePayload(value: unknown): CausalLifeEpisode | null {
  try { return payload(value); } catch (error) {
    if (error instanceof MemoryDataError || error instanceof SyntaxError) return null;
    throw error;
  }
}

/** Rebuildable index. Canonical event rows are never rewritten or inferred here. */
export class CausalRecallStore {
  constructor(private readonly db: Database.Database) {}
  ensure(): void {
    const present = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='causal_recall_postings'").get() !== undefined;
    this.db.exec(CAUSAL_RECALL_SCHEMA);
    if (!present) this.db.prepare('DELETE FROM causal_recall_build').run();
    const target = integer(record(this.db.prepare('SELECT coalesce(max(rowid),0) AS target FROM causal_life_episodes').get()).target);
    this.db.prepare('INSERT OR IGNORE INTO causal_recall_build VALUES(1,0,?,?)').run(target, target === 0 ? 1 : 0);
  }
  index(episode: CausalLifeEpisode, order: number): void {
    const insert = this.db.prepare('INSERT OR IGNORE INTO causal_recall_postings VALUES(?,?,?,?)');
    for (const key of causalRecallBuckets(episode)) insert.run(key, episode.appRunId, episode.sequence, order);
  }
  /** One ≤64-row batch between worker requests; no timer, catch-up loop or tick SQL. */
  maintain(): void {
    this.db.transaction(() => {
      const state = record(this.db.prepare('SELECT cursor,target,complete FROM causal_recall_build WHERE id=1').get());
      if (state.complete === 1) return;
      const cursor = integer(state.cursor), target = integer(state.target);
      const rows = this.db.prepare('SELECT rowid AS ordinal,payload FROM causal_life_episodes WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT 64').all(cursor, target);
      let next = cursor;
      for (const row of rows) {
        const r = record(row); next = integer(r.ordinal, 1);
        const episode = eligiblePayload(r.payload);
        if (episode) this.index(episode, next);
      }
      this.db.prepare('UPDATE causal_recall_build SET cursor=?,complete=? WHERE id=1').run(next, rows.length < 64 || next >= target ? 1 : 0);
    }).immediate();
  }
  find(value: unknown): CausalRecallPage {
    const query = causalRecallQuery(value);
    this.ensure();
    return this.db.transaction((): CausalRecallPage => {
      const state = record(this.db.prepare('SELECT complete FROM causal_recall_build WHERE id=1').get());
      const rows = this.db.prepare('SELECT app_run_id,sequence FROM causal_recall_postings WHERE key=? ORDER BY insertion_order DESC,app_run_id COLLATE BINARY,sequence LIMIT 16').all(query.key);
      const candidates: CausalRecallPage['candidates'][number][] = [];
      let fetched = 0;
      for (const row of rows) {
        const r = record(row), appRunId = text(r.app_run_id), sequence = integer(r.sequence, 1);
        if (query.exclude?.appRunId === appRunId && query.exclude.sequence === sequence) continue;
        const found = this.db.prepare('SELECT payload FROM causal_life_episodes WHERE app_run_id=? AND sequence=?').get(appRunId, sequence);
        fetched++;
        if (!found) continue;
        const episode = eligiblePayload(record(found).payload);
        if (!episode || episode.appRunId !== appRunId || episode.sequence !== sequence || episode.occurredAt >= query.before || !causalRecallBuckets(episode).includes(causalRecallKey(query.key))) continue;
        candidates.push({ source: { appRunId, sequence, revision: 1 }, episode, match: 'exact_causal_bucket' });
      }
      return { candidates, coverage: state.complete === 1 ? 'complete' : 'index_building', examined: rows.length, fetched };
    })();
  }
  clear(): void { this.db.exec('DELETE FROM causal_recall_postings; DELETE FROM causal_recall_build; INSERT INTO causal_recall_build VALUES(1,0,0,1);'); }
}
