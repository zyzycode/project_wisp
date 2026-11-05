import { dropMusic } from './schema-fixture';
import { CausalLifeStore } from '../../../src/infrastructure/memory/causal-life-store';
import { lifeWindow } from '../../../src/infrastructure/memory/life-history-validation';
import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import { LifeHistoryStore } from '../../../src/infrastructure/memory/life-history-store';
import type { CausalLifeEpisode } from '../../../src/application/ports/causal-life.interface';

const now = '2026-11-05T12:00:00.000Z', query = { fromDateUTC: '2026-10-23', throughDateUTC: '2026-11-05', asOf: now };
const dirs: string[] = [], stores: SqliteMemoryStore[] = [];
function fixture() { const dir = mkdtempSync(path.join(os.tmpdir(), 'wisp-life-window-')); dirs.push(dir); const file = path.join(dir, 'memory.db'); const store = SqliteMemoryStore.open(file, now); stores.push(store); return { store, file }; }
function run(store: SqliteMemoryStore, operation: string, payload: unknown, generation = 0) { return store.execute({ id: 1, operation, payload, generation }); }
function seed(file: string, events: readonly CausalLifeEpisode[]) { const db = new Database(file); db.transaction(() => { const canonical = new CausalLifeStore(db); for (const event of events) canonical.append(event); }).immediate(); db.close(); }
function game(i: number): CausalLifeEpisode { return { appRunId: 'app', sequence: i, revision: 1, occurredAt: now, source: 'autonomy', triggerSequence: null, activityRunId: `run${i}`, activity: 'cursor_game', outcome: 'completed', terminalReason: null, cause: 'completed', executedMs: 1000, participation: 'user_engaged' }; }
afterEach(() => { stores.splice(0).forEach(s => s.close()); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
it('includes same-millisecond facts, uses occurrence then insertion order and preserves #171 exclusive before', () => {
  const { store } = fixture(); run(store, 'appendCausalLife', game(2)); run(store, 'appendCausalLife', game(1));
  expect(run(store, 'readLifeWindow', query)).toMatchObject({ ok: true, value: { coverage: 'complete', events: [game(2), game(1)], examined: 2, fetched: 2 } });
  expect(run(store, 'findCausalLife', { key: 'game.any', before: now })).toMatchObject({ ok: true, value: { candidates: [] } });
  expect(run(store, 'readLifeWindow', { ...query, fromDateUTC: '2026-10-22' })).toEqual({ ok: false, code: 'invalid_data' });
});
it('omits all facts on overflow, clock rollback/future fact or a damaged index payload size', () => {
  const { store, file } = fixture(); seed(file, Array.from({ length: 1001 }, (_, i) => game(i + 1)));
  expect(run(store, 'readLifeWindow', query)).toMatchObject({ ok: true, value: { coverage: 'overflow', events: [], examined: 1001, fetched: 0 } });
  run(store, 'clear', null, 1); run(store, 'appendCausalLife', game(1), 1);
  expect(run(store, 'readLifeWindow', { ...query, asOf: '2026-11-05T11:00:00.000Z' }, 1)).toMatchObject({ value: { coverage: 'clock_unknown', events: [] } });
  run(store, 'readLifeWindow', query, 1);
  expect(run(store, 'readLifeWindow', { ...query, asOf: '2026-11-05T11:59:59.000Z' }, 1)).toMatchObject({ value: { coverage: 'clock_unknown', events: [] } });
  const db = new Database(file); db.prepare('UPDATE causal_history_index SET payload_bytes=1').run(); db.close();
  expect(run(store, 'readLifeWindow', query, 1)).toMatchObject({ value: { coverage: 'clock_unknown', events: [], fetched: 1 } });
});
it('rebuilds a missing disposable index in batches of at most64 without deleting canonical rows', () => {
  const { store, file } = fixture(); for (let i = 1; i <= 130; i++) run(store, 'appendCausalLife', game(i)); store.close();
  const db = new Database(file); db.exec('DROP TABLE causal_history_index'); const index = new LifeHistoryStore(db); index.ensure();
  expect(index.read(query).coverage).toBe('index_building'); index.maintain(); expect(index.read(query).coverage).toBe('index_building'); index.maintain(); expect(index.read(query).coverage).toBe('index_building'); index.maintain(); expect(index.read(query).events).toHaveLength(130);
  expect(db.prepare('SELECT count(*) AS n FROM causal_life_episodes').get()).toEqual({ n: 130 }); db.close();
});
it('uses actual UTF-8 bytes for whole-window omission even with only1000 canonical sources', () => {
  const { store, file } = fixture();
  seed(file, Array.from({ length: 1000 }, (_, i) => ({ ...game(i + 2), source: 'user', triggerSequence: 1, cause: 'user_interrupted', outcome: 'cancelled', terminalReason: 'user_interaction', appRunId: '界'.repeat(128), activityRunId: '界'.repeat(124) + i })));
  const result = run(store, 'readLifeWindow', query);
  expect(result.ok).toBe(true);
  if (result.ok) { const page = lifeWindow(result.value); expect({ ...page, events: page.events.length }).toEqual({ coverage: 'overflow', events: 0, examined: 1000, fetched: 0 }); }
});
it('rolls schema11 DDL and journal back atomically on migration failure', () => {
  const { store, file } = fixture(); run(store, 'appendCausalLife', game(1)); store.close();
  const db = new Database(file); dropMusic(db); db.exec("DROP TABLE causal_history_index; DROP TABLE causal_history_build; DROP TABLE life_derived_turns; DELETE FROM schema_migrations WHERE version=11; PRAGMA user_version=10; CREATE TRIGGER reject_v11 BEFORE INSERT ON schema_migrations WHEN NEW.version=11 BEGIN SELECT RAISE(ABORT,'test'); END;"); db.close();
  expect(() => SqliteMemoryStore.open(file, now)).toThrow();
  const check = new Database(file); expect(check.pragma('user_version', { simple: true })).toBe(10);
  expect(check.prepare("SELECT name FROM sqlite_master WHERE name IN ('causal_history_index','life_derived_turns')").all()).toEqual([]);
  expect(check.prepare('SELECT count(*) AS n FROM causal_life_episodes').get()).toEqual({ n: 1 }); check.exec('DROP TRIGGER reject_v11'); check.close();
  const reopened = SqliteMemoryStore.open(file, now); stores.push(reopened);
  expect(run(reopened, 'readLifeWindow', query)).toMatchObject({ value: { coverage: 'index_building', events: [] } });
  expect(run(reopened, 'readLifeWindow', query)).toMatchObject({ value: { coverage: 'complete', events: [game(1)] } });
});
it('supports an explicit historical UTC period while keeping asOf inclusive at the current capture time', () => {
  const { store } = fixture(); const historical = { ...game(1), occurredAt: '2026-11-01T23:59:59.999Z' };
  run(store, 'appendCausalLife', historical); run(store, 'appendCausalLife', game(2));
  expect(run(store, 'readLifeWindow', { fromDateUTC: '2026-10-23', throughDateUTC: '2026-11-01', asOf: now })).toMatchObject({ value: { coverage: 'complete', events: [historical], examined: 1, fetched: 1 } });
  expect(run(store, 'readLifeWindow', { ...query, throughDateUTC: '2026-11-06' })).toEqual({ ok: false, code: 'invalid_data' });
});
