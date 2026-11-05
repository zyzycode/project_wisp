import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scenario } from './autonomy-scenario-fixture';
import { DeferredGameInvitationRuntime } from '../../src/application/services/deferred-game-invitation-runtime';
import { SqliteMemoryStore } from '../../src/infrastructure/memory/sqlite-store';
import { deferredInvitation } from '../../src/infrastructure/memory/deferred-invitation-validation';
import type { CausalLifeEpisode, IDeferredGameInvitationRepository } from '../../src/application/ports/causal-life.interface';
import type { Operation } from '../../src/infrastructure/memory/protocol';
import type { MemoryResult } from '../../src/application/ports/memory-repository.interface';
import type { SystemIdleReading } from '../../src/application/ports/system-idle.port';
const base=Date.parse('2026-11-05T10:00:00.000Z');
const stores:SqliteMemoryStore[]=[],dirs:string[]=[];
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
async function flush(){for(let i=0;i<10;i++)await Promise.resolve();}
function fixture(){
 const dir=mkdtempSync(path.join(os.tmpdir(),'wisp-invite-main-'));dirs.push(dir);
 const file=path.join(dir,'memory.db');const store=SqliteMemoryStore.open(file,new Date(base).toISOString());stores.push(store);
 let generation=0;
 const command=(operation:Operation,payload:unknown,gen=generation)=>store.execute({id:1,operation,payload,generation:gen});
 function empty(result:MemoryResult<unknown>):MemoryResult<void>{if(!result.ok)return result;expect(result.value).toBeUndefined();return{ok:true,value:undefined};}
 const repository:IDeferredGameInvitationRepository={
  create:async(i,c)=>empty(command('createDeferredInvitation',i,c.generation)),
  read:async(now,c)=>{const r=command('readDeferredInvitation',now,c.generation);return r.ok?{ok:true,value:r.value===null?null:deferredInvitation(r.value)}:r;},
  claim:async(id,now,c)=>{const r=command('claimDeferredInvitation',{id,now},c.generation);if(!r.ok)return r;if(typeof r.value!=='boolean')throw new Error('bad bool');return{ok:true,value:r.value};},
  finish:async(id,state,c)=>empty(command('finishDeferredInvitation',{id,state},c.generation)),
 };
 let runtime:DeferredGameInvitationRuntime|undefined;
 let reading:SystemIdleReading={status:'available',idleMs:1000};
 const social=vi.fn();
 const f=scenario({attention:0,play:0,boredom:0},.5,undefined,undefined,{
  systemIdle:{read:()=>reading,subscribeLifecycle:()=>()=>{},dispose:()=>{}},onSocialBidStarted:social,
  deferredInvitation:{opportunity:()=>runtime?.opportunity()??false,activityStarted:id=>runtime?.activityStarted(id),terminal:(id,c)=>runtime?.terminal(id,c),cancel:()=>{void runtime?.cancel();},invalidateAdmission:()=>runtime?.invalidateAdmission()},
 });
 runtime=new DeferredGameInvitationRuntime({repository,context:()=>({generation}),wallNow:()=>base+f.now(),monotonicNow:()=>f.now(),creationAllowed:()=>f.main.canRetainDeferredInvitation(),createId:()=> 'durable',eligible:()=>f.main.canStartDeferredInvitation(),start:()=>f.main.startDeferredInvitation(),onOpportunityFinished:()=>f.main.finishDeferredInvitationOpportunity()});
 const episode:CausalLifeEpisode={appRunId:'app',sequence:1,revision:1,occurredAt:new Date(base).toISOString(),source:'autonomy',triggerSequence:null,activityRunId:'game',activity:'cursor_game',outcome:'completed',terminalReason:null,cause:'completed',executedMs:2000,participation:'user_engaged'};
 const seed=async()=>{expect(command('appendCausalLife',episode).ok).toBe(true);runtime!.observed(episode,0);runtime!.committed(episode,{generation},0);await flush();};
 const atReady=()=>{f.elapse(300000);f.main.tick();};
 return{...f,runtime,repository,social,seed,atReady,command,file,setReading:(value:SystemIdleReading)=>{reading=value;},reset:()=>{runtime!.invalidate();generation++;expect(command('clear',null,generation).ok).toBe(true);}};
}
it('carries committed source through a real P4 claim, actual SocialBid start, one token and terminal SQLite receipt',async()=>{
 const f=fixture();await f.seed();expect(f.runtime.opportunity()).toBe(false);f.atReady();
 // Existing cadence, not a new timer, owns the opportunity.
 expect(f.pulse()).toBe(true);await flush();
 expect(f.main.getActivityTimeline()?.activityId).toBe('social_bid');expect(f.social).toHaveBeenCalledTimes(1);
 expect(f.command('claimDeferredInvitation',{id:'durable',now:new Date(base+f.now()).toISOString()})).toEqual({ok:true,value:false});
 f.finish();await flush();expect(f.command('readDeferredInvitation',new Date(base+f.now()).toISOString())).toMatchObject({ok:true,value:{state:'completed'}});
 f.elapse(120000);f.main.tick();for(let i=0;i<3;i++){f.pulse();f.finish();await flush();}
 expect(f.social).toHaveBeenCalledTimes(1);await f.runtime.dispose();f.main.dispose();
});
it('keeps pending during a busy peer and requires fresh positive presence capability',async()=>{
 const f=fixture();await f.seed();f.atReady();f.offer('think');
 expect(f.runtime.opportunity()).toBe(false);
 f.finish();f.setReading({status:'unavailable',reason:'unsupported'});f.advance(3000);expect(f.runtime.opportunity()).toBe(false);
 expect(f.command('readDeferredInvitation',new Date(base+f.now()).toISOString())).toMatchObject({ok:true,value:{state:'pending'}});
 await f.runtime.dispose();f.main.dispose();
});
it('cancels on user input/quiet/disable, preserves menu-pending and resets without late resurrection',async()=>{
 const menu=fixture();await menu.seed();menu.main.setMenuOpen(true);expect(menu.runtime.opportunity()).toBe(false);
 expect(menu.command('readDeferredInvitation',new Date(base).toISOString())).toMatchObject({ok:true,value:{state:'pending'}});await menu.runtime.dispose();menu.main.dispose();
 for(const gate of ['user','quiet','disabled','reset'] as const){const f=fixture();await f.seed();
  if(gate==='user')f.main.acceptDialogueContact();if(gate==='quiet')f.main.setQuietMode(true);if(gate==='disabled')f.main.setEnabled(false);if(gate==='reset')f.reset();await flush();
  const result=f.command('readDeferredInvitation',new Date(base+f.now()).toISOString());
  expect(result).toMatchObject(gate==='reset'?{ok:true,value:null}:{ok:true,value:{state:'cancelled'}});
  await f.runtime.dispose();f.main.dispose();
 }
});
it('leaves the runner available during claim and abandons the ack after an unrelated provider run starts',async()=>{
 const f=fixture();await f.seed();f.atReady();expect(f.runtime.opportunity()).toBe(true);
 f.offer('think');await flush();expect(f.main.getActivityTimeline()?.activityId).not.toBe('social_bid');
 expect(f.social).not.toHaveBeenCalled();expect(f.command('readDeferredInvitation',new Date(base+f.now()).toISOString())).toMatchObject({ok:true,value:{state:'abandoned'}});
 await f.runtime.dispose();f.main.dispose();
});
it('does not claim using a stale positive presence sample or while the shared initiative budget is spent',async()=>{
 const f=fixture();await f.seed();f.atReady();f.elapse(2501);expect(f.runtime.opportunity()).toBe(false);
 f.main.tick();expect(f.main.spendObservationBudget(f.now())).toBe(true);expect(f.runtime.opportunity()).toBe(false);
 expect(f.command('readDeferredInvitation',new Date(base+f.now()).toISOString())).toMatchObject({ok:true,value:{state:'pending'}});
 await f.runtime.dispose();f.main.dispose();
});
