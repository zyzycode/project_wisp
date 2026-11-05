import type Database from 'better-sqlite3';
import { causalEpisode, causalSources } from './causal-life-validation';
import { CausalRecallStore } from './causal-recall-store';
import { integer, MemoryDataError, record, text } from './validation-primitives';

export const CAUSAL_LIFE_SCHEMA = `
CREATE TABLE causal_life_episodes (app_run_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence > 0), activity_run_id TEXT, payload TEXT NOT NULL, PRIMARY KEY(app_run_id, sequence));
CREATE UNIQUE INDEX causal_life_terminal_run ON causal_life_episodes(app_run_id, activity_run_id) WHERE activity_run_id IS NOT NULL;
`;
function row(value: unknown) { return causalEpisode(JSON.parse(text(record(value).payload, 4096))); }
export class CausalLifeStore {
  constructor(private readonly db: Database.Database) {}
  append(value: unknown): void {
    const episode = causalEpisode(value), payload = JSON.stringify(episode);
    this.db.transaction(() => {
      const existing = this.db.prepare('SELECT payload FROM causal_life_episodes WHERE app_run_id = ? AND sequence = ?').get(episode.appRunId, episode.sequence);
      if (existing !== undefined) {
        if (JSON.stringify(row(existing)) !== payload) throw new MemoryDataError('conflict');
        return;
      }
      const result = this.db.prepare('INSERT INTO causal_life_episodes VALUES (?, ?, ?, ?)').run(episode.appRunId, episode.sequence, episode.activityRunId, payload);
      new CausalRecallStore(this.db).index(episode, Number(result.lastInsertRowid));
    }).immediate();
  }
  recent(value: unknown) {
    return this.db.prepare('SELECT payload FROM (SELECT rowid, payload FROM causal_life_episodes ORDER BY rowid DESC LIMIT ?) ORDER BY rowid').all(integer(value, 1, 100)).map(row);
  }
  resolve(value: unknown) {
    const query = this.db.prepare('SELECT payload FROM causal_life_episodes WHERE app_run_id = ? AND sequence = ?');
    return causalSources(value).flatMap(ref => { const found = query.get(ref.appRunId, ref.sequence); return found === undefined ? [] : [row(found)]; });
  }
}
