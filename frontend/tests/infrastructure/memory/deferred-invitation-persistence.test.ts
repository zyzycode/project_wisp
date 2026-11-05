import { dropSocialInterpretation } from './schema-fixture';
import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import { initializeSchema } from '../../../src/infrastructure/memory/schema';
import { invitationWindow } from '../../../src/domain/behavior/deferred-game-invitation';
const now='2026-11-05T10:00:00.000Z',ready='2026-11-05T10:05:00.000Z';
const episode={appRunId:'app',sequence:1,revision:1,occurredAt:now,source:'autonomy',triggerSequence:null,activityRunId:'game',activity:'cursor_game',outcome:'completed',terminalReason:null,cause:'completed',executedMs:2000,participation:'user_engaged'};
const invitation={id:'invite',sourceAppRunId:'app',sourceSequence:1,createdAt:now,...invitationWindow(now),state:'pending'};
const stores:SqliteMemoryStore[]=[],dirs:string[]=[];
function open(file:string){const s=SqliteMemoryStore.open(file,now);stores.push(s);return s;}
function command(s:SqliteMemoryStore,operation:string,payload:unknown=null,generation=0){return s.execute({id:1,operation,payload,generation});}
function fixture(){const dir=mkdtempSync(path.join(os.tmpdir(),'wisp-invite-db-'));dirs.push(dir);const file=path.join(dir,'memory.db');return{file,store:open(file)};}
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
it('adds schema8 atomically to populated schema7 and preserves sources across a real restart',()=>{
 const f=fixture();expect(command(f.store,'appendCausalLife',episode).ok).toBe(true);f.store.close();
 const db=new Database(f.file);dropSocialInterpretation(db);db.exec('DROP TABLE deferred_game_invitation; DROP TABLE deferred_invitation_sources; DELETE FROM schema_migrations WHERE version=8; PRAGMA user_version=7;');
 db.exec("CREATE TRIGGER reject_v8 BEFORE INSERT ON schema_migrations WHEN NEW.version=8 BEGIN SELECT RAISE(ABORT,'test'); END;");
 expect(()=>initializeSchema(db,now)).toThrow();expect(db.pragma('user_version',{simple:true})).toBe(7);
 expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'deferred_%'").all()).toEqual([]);
 expect(db.prepare('SELECT count(*) n FROM causal_life_episodes').get()).toEqual({n:1});db.exec('DROP TRIGGER reject_v8');db.close();
 const restored=open(f.file);expect(command(restored,'createDeferredInvitation',invitation).ok).toBe(true);
 restored.close();const restarted=open(f.file);expect(command(restarted,'readDeferredInvitation',ready)).toMatchObject({ok:true,value:{state:'pending'}});
 expect(command(restarted,'claimDeferredInvitation',{id:'invite',now:ready})).toEqual({ok:true,value:true});restarted.close();
 expect(command(open(f.file),'readDeferredInvitation',ready)).toMatchObject({ok:true,value:{state:'abandoned'}});
});
it('full reset clears source markers and rejects old-generation acknowledgement paths',()=>{
 const f=fixture();command(f.store,'appendCausalLife',episode);command(f.store,'createDeferredInvitation',invitation);
 expect(command(f.store,'clear',null,1).ok).toBe(true);
 expect(command(f.store,'claimDeferredInvitation',{id:'invite',now:ready})).toEqual({ok:false,code:'stale'});
 expect(command(f.store,'readDeferredInvitation',ready,1)).toEqual({ok:true,value:null});
 expect(command(f.store,'appendCausalLife',episode,1).ok).toBe(true);expect(command(f.store,'createDeferredInvitation',invitation,1).ok).toBe(true);
 expect(command(f.store,'readDeferredInvitation',ready,1)).toMatchObject({ok:true,value:{state:'pending'}});
});
it('validates exact worker commands before mutating and never accepts a false completed receipt',()=>{
 const f=fixture();command(f.store,'appendCausalLife',episode);
 for(const bad of [{...invitation,extra:'private'},{...invitation,sourceSequence:0},{...invitation,notBefore:now},{...invitation,state:'completed'}])expect(command(f.store,'createDeferredInvitation',bad)).toEqual({ok:false,code:'invalid_data'});
 command(f.store,'createDeferredInvitation',invitation);
 expect(command(f.store,'claimDeferredInvitation',{id:'invite',now:ready,extra:true})).toEqual({ok:false,code:'invalid_data'});
 expect(command(f.store,'finishDeferredInvitation',{id:'invite',state:'completed'})).toEqual({ok:false,code:'conflict'});
 expect(command(f.store,'readDeferredInvitation',now)).toMatchObject({ok:true,value:{state:'pending'}});
});
