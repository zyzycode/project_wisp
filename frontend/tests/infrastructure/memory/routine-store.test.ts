import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import type { Operation } from '../../../src/infrastructure/memory/protocol';
import type { RoutineCaptureIdentity } from '../../../src/application/ports/routine-observation.port';
const now = '2026-10-26T00:00:00.000Z', start = Date.parse(now);
const directories: string[] = [], stores: SqliteMemoryStore[] = [];
function fixture() { const dir = mkdtempSync(path.join(os.tmpdir(),'wisp-routine-')); directories.push(dir); const filename = path.join(dir,'memory.sqlite'); const store = SqliteMemoryStore.open(filename,now); stores.push(store); return {store,filename}; }
function run(store: SqliteMemoryStore, operation: Operation, payload: unknown = null, generation = 0) { return store.execute({ id:1, operation, payload, generation }); }
function begin(store: SqliteMemoryStore, extra = {}, generation = 0): RoutineCaptureIdentity { const result = run(store,'beginRoutine',{atUtcMs:start,zoneId:'Etc/UTC',offsetMinutes:0,candidateCohortId:'first',forceNewCohort:false,...extra},generation); if (!result.ok) throw new Error(result.code); return result.value as RoutineCaptureIdentity; }
function observation(identity: RoutineCaptureIdentity, extra = {}) { return {...identity,appRunId:'run',sequence:1,startUtcMs:start,endUtcMs:start+300000,zoneId:'Etc/UTC',offsetMinutes:0,localDate:'2026-10-26',tuningId:'AFK-A01-v1',activeMs:100000,inactiveMs:100000,awayMs:50000,unknownMs:50000,...extra}; }
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of directories.splice(0)) rmSync(dir,{recursive:true,force:true}); });
it('replays exact rows, rejects altered identities, overlaps and malformed data', () => {
  const {store} = fixture(), id = begin(store), row = observation(id);
  expect(run(store,'appendRoutine',row).ok).toBe(true); expect(run(store,'appendRoutine',row).ok).toBe(true);
  expect(run(store,'appendRoutine',{...row,activeMs:90000})).toEqual({ok:false,code:'conflict'});
  expect(run(store,'appendRoutine',{...row,sequence:2})).toEqual({ok:false,code:'conflict'});
  expect(run(store,'appendRoutine',{...row,datasetEpoch:'old'})).toEqual({ok:false,code:'conflict'});
  for (const extra of [{unknown:1},{zoneId:'bad/zone'},{sequence:0},{endUtcMs:start},{endUtcMs:start+300001},{activeMs:300001},{localDate:'2026-02-30'},{startUtcMs:start+1,endUtcMs:start+300001}]) expect(run(store,'appendRoutine',{...row,...extra})).toEqual({ok:false,code:'invalid_data'});
});
it('checks both neighboring intervals and accepts adjacent partial rows', () => {
  const {store} = fixture(), id = begin(store);
  const row = observation(id,{activeMs:0,inactiveMs:0,awayMs:0,unknownMs:1000,endUtcMs:start+1000});
  expect(run(store,'appendRoutine',{...row,sequence:2,startUtcMs:start+2000,endUtcMs:start+3000}).ok).toBe(true);
  expect(run(store,'appendRoutine',row).ok).toBe(true);
  expect(run(store,'appendRoutine',{...row,sequence:3,startUtcMs:start+1000,endUtcMs:start+2500})).toEqual({ok:false,code:'conflict'});
  expect(run(store,'appendRoutine',{...row,sequence:3,startUtcMs:start+1000,endUtcMs:start+2000}).ok).toBe(true);
});
it('reuses persisted cohort across restart and ordinary memory generations, rotating on clock or zone break', () => {
  const {store,filename} = fixture(), id = begin(store); run(store,'appendRoutine',observation(id)); store.close();
  const reopened = SqliteMemoryStore.open(filename,now); stores.push(reopened);
  expect(begin(reopened,{atUtcMs:start+300000,candidateCohortId:'unused'})).toEqual(id);
  expect(run(reopened,'mutateBeverage',{kind:'reject',commandId:'x',expected:{itemId:'absent',revision:1},updatedAt:now},1).ok).toBe(false);
  expect(begin(reopened,{atUtcMs:start+300000,candidateCohortId:'unused'},1)).toEqual(id);
  const rotated = begin(reopened,{atUtcMs:start-1,candidateCohortId:'clock'},1); expect(rotated).toEqual({...id,cohortId:'clock'});
  const zone = begin(reopened,{zoneId:'Europe/London',candidateCohortId:'zone'},1); expect(zone).toEqual({...id,cohortId:'zone'});
  expect(run(reopened,'appendRoutine',observation(id),1)).toEqual({ok:false,code:'conflict'});
});
it('reports latest receipt after backward-clock cohorts and rotates epoch atomically on clear', () => {
  const {store,filename} = fixture(), id = begin(store); run(store,'appendRoutine',observation(id));
  const second = begin(store,{atUtcMs:start-300000,candidateCohortId:'back'});
  run(store,'appendRoutine',observation(second,{sequence:2,startUtcMs:start-300000,endUtcMs:start,localDate:'2026-10-25'}));
  expect(run(store,'readRoutineStatus')).toEqual({ok:true,value:{...second,latestEndUtcMs:start,zoneId:'Etc/UTC',offsetMinutes:0}});
  const db = new Database(filename); db.exec("CREATE TRIGGER prevent_clear BEFORE DELETE ON routine_observations BEGIN SELECT RAISE(ABORT,'test'); END;");
  expect(run(store,'clear',null,1)).toEqual({ok:false,code:'conflict'});
  expect(run(store,'readRoutineStatus',null,1)).toEqual({ok:true,value:{...second,latestEndUtcMs:start,zoneId:'Etc/UTC',offsetMinutes:0}});
  db.exec('DROP TRIGGER prevent_clear'); db.close();
  expect(run(store,'clear',null,2).ok).toBe(true);
  const status = run(store,'readRoutineStatus',null,2); expect(status.ok).toBe(true); if (status.ok) expect(status.value).toEqual({datasetEpoch:expect.not.stringMatching(`^${id.datasetEpoch}$`),cohortId:expect.any(String),latestEndUtcMs:null,zoneId:null,offsetMinutes:null});
  expect(run(store,'appendRoutine',observation(second),1)).toEqual({ok:false,code:'stale'});
  expect(run(store,'appendRoutine',observation(second),2)).toEqual({ok:false,code:'conflict'});
});
it('additively migrates schema4 preserving every legacy table and measures a synthetic day', () => {
  const {store,filename} = fixture(); store.close(); const db = new Database(filename);
  db.exec("DROP TABLE routine_observations; DROP TABLE routine_metadata; DELETE FROM schema_migrations WHERE version=5; PRAGMA user_version=4;");
  db.prepare('INSERT INTO user_facts VALUES (?,?,?,?,?,?,?)').run('fact','name','Ира',1,null,now,now);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[];
  const before = tables.map(({name})=>({name,rows:db.prepare(`SELECT * FROM "${name}"`).all()})); db.close();
  const reopened = SqliteMemoryStore.open(filename,now); stores.push(reopened); const id=begin(reopened);
  const check = new Database(filename); for (const {name,rows} of before) if(name!=='schema_migrations') expect(check.prepare(`SELECT * FROM "${name}"`).all()).toEqual(rows);
  check.pragma('wal_checkpoint(TRUNCATE)'); const baseline=statSync(filename).size;
  for(let i=0;i<288;i++) expect(run(reopened,'appendRoutine',observation(id,{sequence:i+1,startUtcMs:start+i*300000,endUtcMs:start+(i+1)*300000})).ok).toBe(true);
  check.pragma('wal_checkpoint(TRUNCATE)'); const bytes=statSync(filename).size-baseline;
  console.info(`routine synthetic day: 288 rows; database increment ${bytes} bytes; ${bytes/288} bytes/row (pages and indexes, checkpointed)`);
  expect(check.prepare('SELECT COUNT(*) AS n FROM routine_observations').get()).toEqual({n:288}); check.close();
});

it('persists fractional monotonic durations without inventing coverage', () => {
  const {store}=fixture(), id=begin(store);
  const row=observation(id,{startUtcMs:start+0.25,endUtcMs:start+1000.75,activeMs:1000.5,inactiveMs:0,awayMs:0,unknownMs:0});
  expect(run(store,'appendRoutine',row).ok).toBe(true);
  expect(run(store,'appendRoutine',row).ok).toBe(true);
  expect(run(store,'readRoutineStatus')).toMatchObject({ok:true,value:{latestEndUtcMs:start+1000.75}});
  expect(run(store,'appendRoutine',{...row,sequence:2,startUtcMs:start+1001,endUtcMs:start+2001,activeMs:1000.01})).toEqual({ok:false,code:'invalid_data'});
});
it('rolls schema5 metadata, tables and migration journal back together on migration failure', () => {
  const {store,filename}=fixture(); store.close(); const db=new Database(filename);
  db.exec("DROP TABLE routine_observations; DROP TABLE routine_metadata; DELETE FROM schema_migrations WHERE version=5; PRAGMA user_version=4; CREATE TRIGGER reject_v5 BEFORE INSERT ON schema_migrations WHEN NEW.version=5 BEGIN SELECT RAISE(ABORT,'test'); END;");
  expect(()=>SqliteMemoryStore.open(filename,now)).toThrow();
  expect(db.pragma('user_version',{simple:true})).toBe(4);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'routine_%'").all()).toEqual([]);
  expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([{version:1},{version:2},{version:3},{version:4}]); db.close();
});
