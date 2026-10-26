import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeSchema } from '../../../src/infrastructure/memory/schema';
import { schema3 } from './schema-fixture';
const now='2026-10-26T10:00:00.000Z';
function fixture(){const dir=mkdtempSync(path.join(os.tmpdir(),'wisp-migration4-'));const db=new Database(path.join(dir,'db'));initializeSchema(db,now);schema3(db);
 db.exec(`INSERT INTO conversation_sessions VALUES ('s','app','${now}',NULL);
 INSERT INTO messages (id,conversation_session_id,role,content,created_at,memory_confirmable) VALUES ('u','s','user','event','${now}',1),('a','s','assistant','reply','${now}',1);
 INSERT INTO memory_items VALUES (3,'event',2,'active','important_event','label','text',NULL,'${now}','cmd','u','a');
 INSERT INTO memory_items VALUES (90,'removed',1,'active','shared_joke','joke','text',NULL,'${now}','removed','u','a');
 DELETE FROM memory_items WHERE id='removed';
 INSERT INTO memory_item_sources VALUES ('event','u','a'); INSERT INTO memory_item_terms VALUES ('event','event',3);
 INSERT INTO memory_suppressed_pairs VALUES ('u','a');
 INSERT INTO memory_mutation_receipts VALUES ('cmd','update','event',2,'active','digest');`);
 return {db,dispose(){db.close();rmSync(dir,{recursive:true,force:true});}};}
const tables=['messages','memory_items','memory_item_sources','memory_item_terms','memory_suppressed_pairs','memory_mutation_receipts','interest_thread','interest_thread_receipts'];
it('rebuilds populated schema3 without losing child rows, old receipt columns or sequence high-water',()=>{const f=fixture();try{
 const before=tables.map(t=>f.db.prepare(`SELECT * FROM ${t}`).all());initializeSchema(f.db,now);
 for(const [i,t] of tables.entries()){const rows=f.db.prepare(`SELECT * FROM ${t}`).all().map(r=>{const x={...r as Record<string,unknown>};for(const k of t==='memory_items'?['beverage_value','beverage_provenance','beverage_validity','beverage_manually_corrected']:t==='memory_mutation_receipts'?['request_id','user_message_id','assistant_message_id']:[])delete x[k];return x;});expect(rows).toEqual(before[i]);}
 expect(f.db.pragma('foreign_keys',{simple:true})).toBe(1);expect(f.db.pragma('foreign_key_check')).toEqual([]);
 expect(f.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='memory_items'").get()).toEqual({seq:90});
 expect(f.db.prepare("SELECT name FROM sqlite_master WHERE name='memory_terms_order'").get()).toEqual({name:'memory_terms_order'});
 expect(f.db.pragma('user_version',{simple:true})).toBe(4);
 }finally{f.dispose();}});
it.each(['DROP TABLE memory_item_sources','DROP TABLE memory_items','ALTER TABLE memory_items_v4 RENAME TO memory_items'])('rolls back DDL, child data and sequence when fault follows %s',fault=>{const f=fixture();try{
 const before=tables.map(t=>f.db.prepare(`SELECT * FROM ${t}`).all());const original=f.db.exec.bind(f.db);
 f.db.exec=(sql:string)=>{if(sql.includes(fault)){const index=sql.indexOf(fault)+fault.length;original(sql.slice(0,index)+';');throw new Error('injected migration fault');}return original(sql);};
 expect(()=>initializeSchema(f.db,now)).toThrow('injected');f.db.exec=original;
 expect(f.db.pragma('user_version',{simple:true})).toBe(3);expect(f.db.pragma('foreign_keys',{simple:true})).toBe(1);
 for(const [i,t] of tables.entries())expect(f.db.prepare(`SELECT * FROM ${t}`).all()).toEqual(before[i]);
 expect(f.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='memory_items'").get()).toEqual({seq:90});
 expect(f.db.prepare("SELECT name FROM sqlite_temp_master WHERE name LIKE 'beverage_%'").all()).toEqual([]);
 }finally{f.dispose();}});
it('preserves sequence high-water when every historical item was deleted',()=>{const f=fixture();try{
 f.db.exec('DELETE FROM memory_item_terms; DELETE FROM memory_item_sources; DELETE FROM memory_items;');
 initializeSchema(f.db,now);expect(f.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='memory_items'").get()).toEqual({seq:90});
 }finally{f.dispose();}});
it('enforces beverage combinations at SQL boundary and indexes source lookups',()=>{const f=fixture();try{
 initializeSchema(f.db,now);
 const insert=f.db.prepare("INSERT INTO memory_items(id,revision,status,category,label,text,confirmed_at,command_id,source_user_id,source_assistant_id,beverage_value,beverage_provenance,beverage_validity,beverage_manually_corrected) VALUES ('beverage',1,?,'beverage_preference','beverage_preference','coffee',?,'new','u','a','coffee',?,?,?)");
 for(const [status,provenance,validity,corrected] of [['active','model_proposal','confirmed',0],['active','user_statement','rejected',0],['active','model_proposal','hypothesis',1],['active','user_statement','hypothesis',0]])expect(()=>insert.run(status,now,provenance,validity,corrected)).toThrow();
 const plan=f.db.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM memory_item_sources WHERE user_message_id=? OR assistant_message_id=? LIMIT 1').all('u','a');
 expect(JSON.stringify(plan)).toContain('memory_sources_user');expect(JSON.stringify(plan)).toContain('memory_sources_assistant');
 expect(JSON.stringify(plan)).not.toContain('SCAN memory_item_sources');
 }finally{f.dispose();}});
