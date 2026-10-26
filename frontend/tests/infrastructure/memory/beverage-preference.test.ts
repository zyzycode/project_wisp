import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import type { Operation } from '../../../src/infrastructure/memory/protocol';
const now='2026-10-26T10:00:00.000Z';
const dirs:string[]=[], stores:SqliteMemoryStore[]=[];
function fixture(){const dir=mkdtempSync(path.join(os.tmpdir(),'wisp-beverage-'));dirs.push(dir);const filename=path.join(dir,'memory.db');const store=SqliteMemoryStore.open(filename,now);stores.push(store);return {store,filename};}
function run(s:SqliteMemoryStore,operation:string,payload:unknown=null,generation=0){return s.execute({id:1,operation:operation as Operation,payload,generation});}
function pair(suffix=''){return {memoryConfirmable:true,session:{id:'s',appRunId:'app',startedAt:now,endedAt:null},user:{id:'u'+suffix,conversationSessionId:'s',role:'user',content:'Я предпочитаю кофе',createdAt:now},assistant:{id:'a'+suffix,conversationSessionId:'s',role:'assistant',content:'Кажется, тебе нравится кофе',createdAt:now}};}
const source={userMessageId:'u',assistantMessageId:'a'};
function save(){return {kind:'save_hypothesis',commandId:'save',itemId:'beverage',expected:null,value:'coffee',source,consented:true,updatedAt:now};}
function ref(revision=1){return {itemId:'beverage',revision};}
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const d of dirs.splice(0))rmSync(d,{force:true,recursive:true});});
it('saves only successful proposal source, isolates cards and preserves inactive slot and receipts',()=>{
 const {store}=fixture();expect(run(store,'appendTurn',{...pair(),beverageProposalSource:true}).ok).toBe(true);
 expect(run(store,'mutateBeverage',save(),1)).toMatchObject({ok:true,value:{ref:ref(),outcome:'hypothesis'}});
 expect(run(store,'readBeverage',null,1)).toMatchObject({ok:true,value:{value:'coffee',validity:'hypothesis',evidenceQuote:pair().user.content}});
 expect(run(store,'listMemoryItems',{limit:20,cursor:null},1)).toMatchObject({ok:true,value:{items:[]}});
 expect(run(store,'mutateBeverage',{kind:'confirm',commandId:'confirm',expected:ref(),value:'coffee',source,confirmed:true,updatedAt:now},2)).toMatchObject({ok:true,value:{outcome:'confirmed'}});
 expect(run(store,'mutateBeverage',{kind:'reject',commandId:'reject',expected:ref(2),updatedAt:now},3)).toMatchObject({ok:true,value:{outcome:'rejected'}});
 expect(run(store,'readBeverage',null,3)).toMatchObject({ok:true,value:{status:'withdrawn',validity:'rejected'}});
 expect(run(store,'getRecent',100,3)).toEqual({ok:true,value:[]});
 expect(run(store,'mutateBeverage',save(),4)).toMatchObject({ok:true,value:{ref:ref(),outcome:'hypothesis'}});
 expect(run(store,'readBeverage',null,4)).toMatchObject({ok:true,value:{ref:ref(3)}});
});
it('durable withdraw precedes bound correction append and rejects altered, unbound and cross-ID replays',()=>{
 const {store}=fixture();run(store,'appendTurn',{...pair(),beverageProposalSource:true});run(store,'mutateBeverage',save(),1);
 run(store,'mutateBeverage',{kind:'withdraw',commandId:'withdraw',expected:ref(),updatedAt:now},2);
 const turn={...pair('2'),beverageCorrection:{expected:ref(2),value:'tea',requestId:'req',userMessageId:'u2'}};
 expect(run(store,'appendTurn',turn,2).ok).toBe(true);
 expect(run(store,'readBeverage',null,2)).toMatchObject({ok:true,value:{ref:ref(3),value:'tea',validity:'confirmed',manuallyCorrected:true}});
 expect(run(store,'appendTurn',turn,2).ok).toBe(true);
 expect(run(store,'appendTurn',pair('2'),2)).toEqual({ok:false,code:'conflict'});
 expect(run(store,'appendTurn',{...turn,assistant:{...turn.assistant,id:'a3'}},2)).toEqual({ok:false,code:'conflict'});
 expect(run(store,'getRecent',100,2)).toEqual({ok:true,value:[]});
});
it('fallback correction and dispatched consumer pairs are suppressed without confirming',()=>{
 const {store,filename}=fixture();run(store,'appendTurn',{...pair(),beverageProposalSource:true});run(store,'mutateBeverage',save(),1);
 expect(run(store,'appendTurn',{...pair('use'),memoryConfirmable:false,beverageUse:{expected:ref(),requestId:'consume',userMessageId:'uuse'}},1).ok).toBe(true);
 run(store,'mutateBeverage',{kind:'withdraw',commandId:'withdraw',expected:ref(),updatedAt:now},2);
 expect(run(store,'appendTurn',{...pair('2'),memoryConfirmable:false,beverageCorrection:{expected:ref(2),value:'tea',requestId:'req',userMessageId:'u2'}},2).ok).toBe(true);
 expect(run(store,'readBeverage',null,2)).toMatchObject({ok:true,value:{status:'withdrawn',ref:ref(2)}});
 expect(run(store,'summaryRecent',null,2)).toMatchObject({ok:true,value:{pairs:[{eligible:false},{eligible:false},{eligible:false}]}});
 run(store,'clear',null,3);const db=new Database(filename);expect(db.prepare('SELECT * FROM memory_mutation_receipts').all()).toEqual([]);db.close();
});
it('retains source suppression after deletion and rejects recycling old evidence under new command/item IDs',()=>{
 const {store,filename}=fixture();run(store,'appendTurn',{...pair(),beverageProposalSource:true});run(store,'mutateBeverage',save(),1);
 expect(run(store,'mutateBeverage',{...save(),commandId:'second',itemId:'second'},2)).toEqual({ok:false,code:'conflict'});
 expect(run(store,'mutateBeverage',{...save(),value:'tea'},3)).toEqual({ok:false,code:'conflict'});
 expect(run(store,'mutateBeverage',{kind:'delete',commandId:'delete',expected:ref(),updatedAt:now},4).ok).toBe(true);
 expect(run(store,'readBeverage',null,4)).toEqual({ok:true,value:null});
 expect(run(store,'mutateBeverage',{...save(),commandId:'new-command',itemId:'new-item'},5)).toEqual({ok:false,code:'conflict'});
 const db=new Database(filename);expect(db.prepare('SELECT * FROM memory_items').all()).toEqual([]);expect(db.prepare('SELECT * FROM memory_suppressed_pairs').all()).toHaveLength(1);expect(db.prepare('SELECT * FROM memory_mutation_receipts').all()).toHaveLength(3);db.close();
 expect(run(store,'getRecent',100,5)).toEqual({ok:true,value:[]});
});
it('allows a fresh proposal after deletion but rejects a regular/consumer/fallback pair as evidence',()=>{
 const {store}=fixture();run(store,'appendTurn',pair());expect(run(store,'mutateBeverage',save(),1)).toEqual({ok:false,code:'conflict'});
 run(store,'appendTurn',{...pair('new'),beverageProposalSource:true},1);
 const fresh={...save(),commandId:'new',itemId:'new',source:{userMessageId:'unew',assistantMessageId:'anew'}};
 expect(run(store,'mutateBeverage',fresh,2).ok).toBe(true);
 expect(run(store,'mutateBeverage',{kind:'withdraw',commandId:'withdraw',expected:{itemId:'new',revision:1},updatedAt:now},3).ok).toBe(true);
 const fallback={...pair('fallback'),memoryConfirmable:false,beverageCorrection:{expected:{itemId:'new',revision:2},value:'tea',requestId:'request',userMessageId:'ufallback'}};
 expect(run(store,'appendTurn',fallback,3).ok).toBe(true);
 expect(run(store,'appendTurn',{...fallback,user:{...fallback.user,id:'uother'}},3)).toEqual({ok:false,code:'conflict'});
 expect(run(store,'appendTurn',{...pair('other'),beverageCorrection:{...fallback.beverageCorrection,userMessageId:'uother'}},3)).toEqual({ok:false,code:'conflict'});
 expect(run(store,'mutateBeverage',{kind:'correct',commandId:'bad',expected:{itemId:'new',revision:2},value:'tea',source:{userMessageId:'ufallback',assistantMessageId:'afallback'},confirmed:true,updatedAt:now},4)).toEqual({ok:false,code:'invalid_data'});
});
it('rolls back a correction append on receipt failure while preserving the durable withdrawal',()=>{
 const {store,filename}=fixture();run(store,'appendTurn',{...pair(),beverageProposalSource:true});run(store,'mutateBeverage',save(),1);run(store,'mutateBeverage',{kind:'withdraw',commandId:'withdraw',expected:ref(),updatedAt:now},2);
 const db=new Database(filename);db.exec("CREATE TRIGGER reject_beverage_turn BEFORE INSERT ON memory_mutation_receipts WHEN NEW.kind='beverage_turn' BEGIN SELECT RAISE(ABORT,'test'); END;");
 expect(run(store,'appendTurn',{...pair('2'),beverageCorrection:{expected:ref(2),value:'tea',requestId:'request',userMessageId:'u2'}},2)).toEqual({ok:false,code:'conflict'});
 expect(run(store,'readBeverage',null,2)).toMatchObject({ok:true,value:{status:'withdrawn',value:'coffee',ref:ref(2)}});expect(db.prepare('SELECT count(*) n FROM messages').get()).toEqual({n:2});db.close();
});
it('keeps correction flag sticky, does not raise it for same-value hypothesis confirmation, and trims source quotes',()=>{
 const {store}=fixture();const initial=pair();initial.user.content='  Я предпочитаю кофе  ';
 run(store,'appendTurn',{...initial,beverageProposalSource:true});run(store,'mutateBeverage',save(),1);
 expect(run(store,'readBeverage',null,1)).toMatchObject({ok:true,value:{evidenceQuote:'Я предпочитаю кофе'}});
 run(store,'mutateBeverage',{kind:'withdraw',commandId:'withdraw',expected:ref(),updatedAt:now},2);
 run(store,'appendTurn',{...pair('2'),beverageCorrection:{expected:ref(2),value:'coffee',requestId:'same',userMessageId:'u2'}},2);
 expect(run(store,'readBeverage',null,2)).toMatchObject({ok:true,value:{manuallyCorrected:false,ref:ref(3)}});
 const own={userMessageId:'u2',assistantMessageId:'a2'};
 run(store,'mutateBeverage',{kind:'correct',commandId:'correct',expected:ref(3),value:'tea',source:own,confirmed:true,updatedAt:now},3);
 run(store,'mutateBeverage',{kind:'confirm',commandId:'confirm-again',expected:ref(4),value:'tea',source:own,confirmed:true,updatedAt:now},4);
 expect(run(store,'readBeverage',null,4)).toMatchObject({ok:true,value:{manuallyCorrected:true,ref:ref(5)}});
});
it('omits an imported shared source and atomically withdraws it before card source deletion',()=>{
 const {store,filename}=fixture();run(store,'appendTurn',{...pair(),beverageProposalSource:true});run(store,'mutateBeverage',save(),1);
 const db=new Database(filename);db.prepare("INSERT INTO memory_items(id,revision,status,category,label,text,confirmed_at,command_id,source_user_id,source_assistant_id) VALUES ('card',1,'active','important_event','Imported','Imported',?,'import','u','a')").run(now);db.exec("INSERT INTO memory_item_sources VALUES ('card','u','a');");
 expect(run(store,'readBeverage',null,1)).toEqual({ok:true,value:null});
 expect(run(store,'mutateMemoryItem',{kind:'delete',commandId:'delete-card',itemId:'card',expectedRevision:1},2).ok).toBe(true);
 expect(run(store,'readBeverage',null,2)).toMatchObject({ok:true,value:{status:'withdrawn',ref:ref(2)}});db.close();
});
it('accepts a fresh successful manual assertion source and retains initial provenance association',()=>{
 const {store,filename}=fixture();run(store,'appendTurn',{...pair(),beverageProposalSource:true});run(store,'mutateBeverage',save(),1);run(store,'appendTurn',pair('new'),1);
 expect(run(store,'mutateBeverage',{kind:'correct',commandId:'manual',expected:ref(),value:'tea',source:{userMessageId:'unew',assistantMessageId:'anew'},confirmed:true,updatedAt:now},2)).toMatchObject({ok:true,value:{outcome:'confirmed'}});
 const db=new Database(filename);expect(db.prepare("SELECT count(*) n FROM memory_item_sources WHERE item_id='beverage'").get()).toEqual({n:2});db.close();
});
