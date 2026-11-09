import { restoreLegacyPreferenceColumns } from './schema-fixture';
import { SCHEMA_VERSION } from '../../../src/infrastructure/memory/schema';
import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeSchema } from '../../../src/infrastructure/memory/schema';
import { CausalLifeStore } from '../../../src/infrastructure/memory/causal-life-store';
import { LifeHistoryStore } from '../../../src/infrastructure/memory/life-history-store';
import { CausalRecallStore } from '../../../src/infrastructure/memory/causal-recall-store';
import type { CausalLifeEpisode } from '../../../src/application/ports/causal-life.interface';

const now = '2026-11-06T12:00:00.000Z', dirs: string[] = [];
const query = { fromDateUTC: '2026-11-01', throughDateUTC: '2026-11-06', asOf: now };
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wisp-book-migration-')); dirs.push(dir);
  const db = new Database(path.join(dir, 'memory.db')); initializeSchema(db, now);
  const canonical = new CausalLifeStore(db);
  for (let sequence = 1; sequence <= 130; sequence++) canonical.append({ appRunId: 'app', sequence, revision: 1,
    occurredAt: now, source: 'autonomy', triggerSequence: null, activityRunId: `game-${sequence}`, activity: 'cursor_game',
    cause: 'completed', outcome: 'completed', terminalReason: null, executedMs: 1000, participation: 'user_engaged' });
  new LifeHistoryStore(db).read(query);
  restoreLegacyPreferenceColumns(db);
  db.exec('DELETE FROM schema_migrations WHERE version>=13; PRAGMA user_version=12;');
  return db;
}
it('advances the format gate atomically and rebuilds both indexes in bounded batches without clock rollback', () => {
  const db = fixture();
  try {
    initializeSchema(db, now);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.prepare('SELECT cursor,target,complete,last_clock FROM causal_history_build').get())
      .toEqual({ cursor: 0, target: 130, complete: 0, last_clock: now });
    const history = new LifeHistoryStore(db), recall = new CausalRecallStore(db);
    expect(history.read({ ...query, asOf: '2026-11-06T11:59:59.000Z' }).coverage).toBe('clock_unknown');
    expect(history.read(query).coverage).toBe('index_building');
    history.maintain(); recall.maintain();
    expect(db.prepare('SELECT cursor FROM causal_history_build').get()).toEqual({ cursor: 64 });
    expect(db.prepare('SELECT cursor FROM causal_recall_build').get()).toEqual({ cursor: 64 });
    history.maintain(); recall.maintain(); history.maintain(); recall.maintain();
    expect(history.read(query).events).toHaveLength(130);
    const book: CausalLifeEpisode = { appRunId: 'app', sequence: 131, revision: 1, occurredAt: now,
      source: 'autonomy', triggerSequence: null, activityRunId: 'book', activity: 'book', cause: 'completed', outcome: 'completed',
      terminalReason: null, executedMs: 14_000, participation: 'solitary' };
    new CausalLifeStore(db).append(book);
    expect(history.read(query).events.at(-1)).toEqual(book);
    expect(db.prepare('SELECT count(*) AS n FROM causal_life_episodes').get()).toEqual({ n: 131 });
  } finally { db.close(); }
});
it('rolls metadata and index reset back together on storage denial', () => {
  const db = fixture();
  try {
    db.exec("CREATE TRIGGER reject_book BEFORE INSERT ON schema_migrations WHEN NEW.version=13 BEGIN SELECT RAISE(ABORT,'test'); END;");
    expect(() => initializeSchema(db, now)).toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(12);
    expect(db.prepare('SELECT count(*) AS n FROM causal_history_index').get()).toEqual({ n: 130 });
    expect(db.prepare('SELECT count(*) AS n FROM causal_life_episodes').get()).toEqual({ n: 130 });
  } finally { db.close(); }
});
