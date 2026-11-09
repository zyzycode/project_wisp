import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import { RoutineHypothesisStore } from '../../../src/infrastructure/memory/routine-hypothesis-store';
import { SCHEMA_VERSION } from '../../../src/infrastructure/memory/schema';
const utc = Date.parse('2026-11-09T07:00:00Z'), day = 86400000, hour = 3600000;
const directories: string[] = [], databases: Database.Database[] = [], stores: SqliteMemoryStore[] = [];
function fixture() {
 const directory = mkdtempSync(path.join(os.tmpdir(), 'wisp-routine-hypothesis-')); directories.push(directory);
 const filename = path.join(directory,'memory.db'), store = SqliteMemoryStore.open(filename,new Date(utc).toISOString()); stores.push(store);
 const db = new Database(filename); databases.push(db); db.prepare("UPDATE routine_metadata SET dataset_epoch='epoch',cohort_id='cohort',zone_id='UTC',offset_minutes=0").run();
 return { db,store,filename, hypothesis:new RoutineHypothesisStore(db) };
}
const query = { datasetEpoch:'epoch',cohortId:'cohort',beforeLocalDate:'2026-11-09',windowStartHour:6,zoneId:'UTC',offsetMinutes:0,nowUtcMs:utc,expiresAtUtcMs:utc+200 };
function seed(db: Database.Database, days = 14) {
 const insert = db.prepare('INSERT INTO routine_observations VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
 db.transaction(() => { for(let date=1;date<=days;date++) for(let bucket=0;bucket<48;bucket++) {
  const start = utc - hour - date*day + bucket*300000;
  insert.run('app',date*100+bucket+1,'epoch','cohort',start,start+300000,'UTC',0,new Date(start).toISOString().slice(0,10),'AFK-A01-v1',bucket<12?300000:0,bucket<12?0:300000,0,0);
 } })();
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(utc); });
afterEach(() => { databases.splice(0).forEach(db=>db.close()); stores.splice(0).forEach(store=>store.close()); directories.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true})); vi.restoreAllMocks(); vi.useRealTimers(); });
it('creates the current four-flag schema and indexed query directly from zero without a new migration', () => {
 const f=fixture(); expect(f.db.prepare('SELECT * FROM routine_suppression ORDER BY window_start').all()).toEqual([0,6,12,18].map(window_start=>({window_start,suppressed:0})));
 expect(f.db.pragma('user_version',{simple:true})).toBe(SCHEMA_VERSION); expect(f.db.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({n:14});
 expect(JSON.stringify(f.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM routine_observations INDEXED BY routine_cohort_date_start WHERE cohort_id=? AND local_date>=? AND local_date<? LIMIT 10001').all('cohort','2026-10-12','2026-11-09'))).toContain('routine_cohort_date_start');
});
it('aggregates acknowledged rows and reopens suppression independently from cohort changes', () => {
 const f=fixture(); seed(f.db); expect(f.hypothesis.read(query)).toMatchObject({suppressed:false,counts:{eligibleDays:14,positiveDays:14,recentPositiveDays:7,qualifies:true}});
 f.hypothesis.suppress({window:6,suppressed:true}); f.db.prepare("UPDATE routine_metadata SET cohort_id='next'").run();
 expect(f.hypothesis.read({...query,cohortId:'next'})).toMatchObject({suppressed:true});
 f.store.close(); stores.splice(stores.indexOf(f.store),1); const reopened=SqliteMemoryStore.open(f.filename,new Date(utc).toISOString()); stores.push(reopened);
 expect(reopened.execute({id:1,generation:0,operation:'readRoutineHypothesis',payload:{...query,cohortId:'next'}})).toMatchObject({ok:true,value:{suppressed:true}});
});
it('rejects a previous dev schema safely instead of adding an upgrade for disposable data', () => {
 const f=fixture(); f.db.exec('DROP TABLE routine_suppression'); f.store.close(); stores.splice(stores.indexOf(f.store),1);
 expect(()=>SqliteMemoryStore.open(f.filename,new Date(utc).toISOString())).toThrow('unsupported_version'); expect(f.db.prepare("SELECT name FROM sqlite_master WHERE name='routine_suppression'").get()).toBeUndefined();
});
it('source changes, missing cohort and expired reads omit the entire derived result', () => {
 const f=fixture(); seed(f.db); expect(f.hypothesis.read({...query,cohortId:'missing'}).counts).toBeNull();
 expect(f.hypothesis.read({...query,expiresAtUtcMs:utc}).counts).toBeNull(); f.db.prepare("UPDATE routine_metadata SET dataset_epoch='new'").run(); expect(f.hypothesis.read(query).counts).toBeNull();
});
it('accepts exactly 10000 examined rows and never returns a truncated-prefix hypothesis at 10001', () => {
 vi.spyOn(performance,'now').mockReturnValue(0); // This assertion measures the row cap, not native latency under parallel test load.
 const f=fixture(), insert=f.db.prepare('INSERT INTO routine_observations VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
 const start=utc-hour-day;
 f.db.transaction(()=>{ for(let i=0;i<10000;i++) insert.run('a',i+1,'epoch','cohort',start+i*2,start+(i+1)*2,'UTC',0,'2026-11-08','AFK-A01-v1',2,0,0,0); })();
 expect(f.hypothesis.read(query).counts).toMatchObject({eligibleDays:0,qualifies:false}); insert.run('a',10001,'epoch','cohort',start+20000,start+20002,'UTC',0,'2026-11-08','AFK-A01-v1',2,0,0,0);
 expect(f.hypothesis.read(query).counts).toBeNull();
});
it('a suppression barrier makes old reads stale and reset clears flags and sources atomically', () => {
 const f=fixture(); seed(f.db); expect(f.store.execute({id:1,generation:1,operation:'suppressRoutineHypothesis',payload:{window:6,suppressed:true}}).ok).toBe(true);
 expect(f.store.execute({id:2,generation:0,operation:'readRoutineHypothesis',payload:query})).toEqual({ok:false,code:'stale'});
 expect(f.store.execute({id:3,generation:2,operation:'clear',payload:null}).ok).toBe(true);
 expect(f.db.prepare('SELECT count(*) AS n FROM routine_observations').get()).toEqual({n:0}); expect(f.db.prepare('SELECT sum(suppressed) AS n FROM routine_suppression').get()).toEqual({n:0});
});
it('permanently suppresses an actually used routine pair from restore, recall and summary sources', () => {
 const f=fixture(), timestamp=new Date(utc).toISOString();
 const session={id:'s',appRunId:'app',startedAt:timestamp,endedAt:null};
 const user={id:'u',conversationSessionId:'s',role:'user',content:'What time?',createdAt:timestamp}, assistant={...user,id:'a',role:'assistant',content:'Maybe you are active then'};
 const turn={session,user,assistant,memoryConfirmable:true,lifeDerivedUse:{requestId:'r',userMessageId:'u',origin:'routine_hypothesis'}};
 expect(f.store.execute({id:1,generation:0,operation:'appendTurn',payload:turn}).ok).toBe(true);
 expect(f.store.execute({id:2,generation:0,operation:'getRecent',payload:100})).toEqual({ok:true,value:[]});
 expect(f.store.execute({id:3,generation:0,operation:'summaryRecent',payload:null})).toMatchObject({ok:true,value:{pairs:[{eligible:false}]}});
 expect(f.store.execute({id:4,generation:0,operation:'appendTurn',payload:turn}).ok).toBe(true);
});
it('omits a read exceeding the 4MiB internal byte cap before returning any partial counts', () => {
 const f=fixture(), insert=f.db.prepare('INSERT INTO routine_observations VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'), epoch='e'.repeat(128),cohort='c'.repeat(128); const start=utc-hour-day;
 f.db.prepare('UPDATE routine_metadata SET dataset_epoch=?,cohort_id=?').run(epoch,cohort);
 f.db.transaction(()=>{ for(let i=0;i<7000;i++) insert.run('x'.repeat(128),i+1,epoch,cohort,start+i*2,start+(i+1)*2,'UTC',0,'2026-11-08','AFK-A01-v1',2,0,0,0); })();
 expect(f.hypothesis.read({...query,datasetEpoch:epoch,cohortId:cohort}).counts).toBeNull();
});
