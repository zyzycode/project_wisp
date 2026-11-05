import { expect, it, vi } from 'vitest';
import { DeferredGameInvitationRuntime } from '../../src/application/services/deferred-game-invitation-runtime';
import type { CausalLifeEpisode, DeferredGameInvitation, IDeferredGameInvitationRepository } from '../../src/application/ports/causal-life.interface';
import type { MemoryResult } from '../../src/application/ports/memory-repository.interface';
import { invitationWindow } from '../../src/domain/behavior/deferred-game-invitation';
const createdAt='2026-11-05T10:00:00.000Z', at=Date.parse(createdAt);
const invitation:DeferredGameInvitation={id:'invite',sourceAppRunId:'app',sourceSequence:1,createdAt,...invitationWindow(createdAt),state:'pending'};
const episode:CausalLifeEpisode={appRunId:'app',sequence:1,revision:1,occurredAt:createdAt,source:'autonomy',triggerSequence:null,activityRunId:'game',activity:'cursor_game',outcome:'completed',terminalReason:null,cause:'completed',executedMs:2000,participation:'user_engaged'};
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
async function flush(){for(let i=0;i<5;i++)await Promise.resolve();}
function fixture(){
 let now=at,generation=0,eligible=true;
 const claim=vi.fn<IDeferredGameInvitationRepository['claim']>(async()=>({ok:true,value:true}));
 const repository:IDeferredGameInvitationRepository={create:vi.fn<IDeferredGameInvitationRepository['create']>(async()=>({ok:true,value:undefined})),read:vi.fn<IDeferredGameInvitationRepository['read']>(async()=>({ok:true,value:invitation})),claim,finish:vi.fn<IDeferredGameInvitationRepository['finish']>(async()=>({ok:true,value:undefined}))};
 const start=vi.fn(()=> 'run'),rearm=vi.fn();
 const runtime=new DeferredGameInvitationRuntime({repository,context:()=>({generation}),wallNow:()=>now,monotonicNow:()=>now-at,createId:()=> 'new',eligible:()=>eligible,start,onOpportunityFinished:rearm});
 runtime.observed(episode,0);
 return{runtime,repository,claim,start,rearm,setNow:(v:number)=>{now=v;},setEligible:(v:boolean)=>{eligible=v;},reset:()=>{generation++;runtime.invalidate();}};
}
it('creates once only from current committed completed user-engaged evidence',async()=>{
 const f=fixture();f.runtime.committed(episode,{generation:0},0);f.runtime.committed(episode,{generation:0},0);await flush();
 expect(f.repository.create).toHaveBeenCalledTimes(1);expect(f.start).not.toHaveBeenCalled();
 f.runtime.committed({...episode,sequence:2,participation:'solitary'},{generation:0},0);f.runtime.committed({...episode,sequence:3},{generation:1},0);
 expect(f.repository.create).toHaveBeenCalledTimes(1);
});
it('waits for both deadline and actual fresh eligibility, then starts once after acknowledged claim',async()=>{
 const f=fixture();await f.runtime.restore();expect(f.runtime.opportunity()).toBe(false);
 f.setNow(at+300000);f.setEligible(false);expect(f.runtime.opportunity()).toBe(false);expect(f.claim).not.toHaveBeenCalled();
 f.setEligible(true);expect(f.runtime.opportunity()).toBe(true);expect(f.runtime.opportunity()).toBe(false);await flush();
 expect(f.start).toHaveBeenCalledTimes(1);expect(f.runtime.hasPending()).toBe(true);
 f.runtime.terminal('other',true);expect(f.repository.finish).not.toHaveBeenCalled();
 f.runtime.terminal('run',true);await flush();expect(f.repository.finish).toHaveBeenCalledWith('invite','completed',{generation:0});
 expect(f.runtime.opportunity()).toBe(false);
});
it('allows unrelated activity while claim is in flight and abandons its late ack',async()=>{
 const f=fixture(),claim=deferred<MemoryResult<boolean>>();f.claim.mockReturnValueOnce(claim.promise);
 await f.runtime.restore();f.setNow(at+300000);expect(f.runtime.opportunity()).toBe(true);
 f.runtime.activityStarted('unrelated');claim.resolve({ok:true,value:true});await flush();
 expect(f.start).not.toHaveBeenCalled();expect(f.repository.finish).toHaveBeenCalledWith('invite','abandoned',{generation:0});
});
it.each(['gate','reset','dispose'] as const)('never starts after %s while claim awaits',async(reason)=>{
 const f=fixture(),claim=deferred<MemoryResult<boolean>>();f.claim.mockReturnValueOnce(claim.promise);
 await f.runtime.restore();f.setNow(at+300000);f.runtime.opportunity();
 if(reason==='gate')f.setEligible(false);else if(reason==='reset')f.reset();else await f.runtime.dispose();
 claim.resolve({ok:true,value:true});await flush();expect(f.start).not.toHaveBeenCalled();
 expect(f.repository.finish).toHaveBeenCalledWith('invite','abandoned',{generation:0});
});
it('lost acknowledgement is not permission and re-arms only the existing cadence',async()=>{
 const f=fixture();f.claim.mockRejectedValueOnce(new Error('lost'));await f.runtime.restore();f.setNow(at+300000);f.runtime.opportunity();await flush();
 expect(f.start).not.toHaveBeenCalled();expect(f.runtime.opportunity()).toBe(false);expect(f.rearm).toHaveBeenCalledTimes(1);
});
it('ordinary disposal preserves pending, while cancellation and expiry are terminal',async()=>{
 const f=fixture();await f.runtime.restore();await f.runtime.dispose();expect(f.repository.finish).not.toHaveBeenCalled();
 const expired=fixture();await expired.runtime.restore();expired.setNow(at+86400000);expect(expired.runtime.opportunity()).toBe(false);await flush();
 expect(expired.repository.finish).toHaveBeenCalledWith('invite','expired',{generation:0});
 const cancel=fixture();await cancel.runtime.restore();await cancel.runtime.cancel();expect(cancel.runtime.opportunity()).toBe(false);
});
it('cancels a durable slot while its initial restore acknowledgement is still pending',async()=>{
 const f=fixture(),read=deferred<MemoryResult<DeferredGameInvitation|null>>();
 vi.mocked(f.repository.read).mockReturnValueOnce(read.promise);
 const restoring=f.runtime.restore();await f.runtime.cancel();read.resolve({ok:true,value:invitation});await restoring;
 expect(f.repository.finish).toHaveBeenCalledWith('invite','cancelled',{generation:0});
 expect(f.runtime.hasPending()).toBe(false);
});
it('cancels a create that commits after user cancellation rather than restoring it late',async()=>{
 const f=fixture(),create=deferred<MemoryResult<void>>();vi.mocked(f.repository.create).mockReturnValueOnce(create.promise);
 f.runtime.committed(episode,{generation:0},0);await f.runtime.cancel();create.resolve({ok:true,value:undefined});await flush();
 expect(f.repository.finish).toHaveBeenCalledWith('new','cancelled',{generation:0});
 expect(f.runtime.hasPending()).toBe(false);
});
it('ordinary shutdown preserves pending while a refresh read awaits, without confusing it with a claim',async()=>{
 const f=fixture();await f.runtime.restore();const read=deferred<MemoryResult<DeferredGameInvitation|null>>();
 vi.mocked(f.repository.read).mockReturnValueOnce(read.promise);
 const refreshing=f.runtime.restore();await f.runtime.dispose();read.resolve({ok:true,value:invitation});await refreshing;
 expect(f.repository.finish).not.toHaveBeenCalled();
});
it('rejects a pre-cancel observed source ack while allowing a later sequence at the same monotonic timestamp',async()=>{
 const f=fixture();f.runtime.observed(episode,0);await f.runtime.cancel();
 f.runtime.committed(episode,{generation:0},0);await flush();expect(f.repository.create).not.toHaveBeenCalled();
 const next={...episode,sequence:2,activityRunId:'next'};
 f.runtime.observed(next,0);f.runtime.committed(next,{generation:0},0);await flush();expect(f.repository.create).toHaveBeenCalledTimes(1);
});
it('does not create from an older trusted observation whose commit acknowledgement follows cancellation',async()=>{
 const f=fixture();f.setNow(at+1);await f.runtime.cancel();f.runtime.committed(episode,{generation:0},0);await flush();
 expect(f.repository.create).not.toHaveBeenCalled();
});
it('does not adopt an older committed callback after a new runtime session observes a later sequence',async()=>{
 const f=fixture();f.runtime.observed({...episode,sequence:5},1);
 // A new runtime has no ownership of an old observed source, even with the same generation.
 const repository=f.repository;
 const fresh=new DeferredGameInvitationRuntime({repository,context:()=>({generation:0}),wallNow:()=>at+1,monotonicNow:()=>1,createId:()=> 'fresh',eligible:()=>true,start:()=> 'run',onOpportunityFinished:()=>{}});
 fresh.observed({...episode,sequence:5},1);fresh.committed(episode,{generation:0},0);await flush();expect(repository.create).not.toHaveBeenCalled();
});
