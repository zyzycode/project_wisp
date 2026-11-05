import { SCHEMA_VERSION } from '../../../src/infrastructure/memory/schema';
import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { musicFixture } from '../../application/music-interest-fixture';
import { dropMusic } from './schema-fixture';
import { initializeSchema } from '../../../src/infrastructure/memory/schema';
import { musicEvidence } from '../../../src/infrastructure/memory/music-validation';
afterEach(()=>vi.useRealTimers());
it('migrates populated schema11 atomically, retains source rows and adds neutral per-source metadata',async()=>{
  const f=musicFixture();try{
    await f.send('An existing ordinary source');const db=new Database(f.filename);
    const before=db.prepare('SELECT id,content,created_at FROM messages ORDER BY sequence').all();
    dropMusic(db);db.pragma('user_version=11');db.exec("CREATE TRIGGER reject_v12 BEFORE INSERT ON schema_migrations WHEN NEW.version=12 BEGIN SELECT RAISE(ABORT,'test'); END;");
    expect(()=>initializeSchema(db,f.timestamp())).toThrow();expect(db.pragma('user_version',{simple:true})).toBe(11);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'music_%'").all()).toEqual([]);
    expect(db.prepare('SELECT id,content,created_at FROM messages ORDER BY sequence').all()).toEqual(before);
    db.exec('DROP TRIGGER reject_v12');initializeSchema(db,f.timestamp());
    expect(db.pragma('user_version',{simple:true})).toBe(SCHEMA_VERSION);
    expect(db.prepare('SELECT music_intention,music_sample_digest,music_preference_consumed FROM messages').all()).toEqual(before.map(()=>({music_intention:0,music_sample_digest:null,music_preference_consumed:0})));
    db.close();
  }finally{await f.dispose();}
});
it('rejects malformed commands, duplicate worker evidence and metadata that disagrees with a canonical source',async()=>{
  const f=musicFixture();try{
    f.advance(300000);await f.send("let's discuss jazz");await f.send("let's keep discussing jazz");
    const result=await f.repository.read(f.timestamp(),{generation:0});if(!result.ok)throw new Error('Missing sample');
    expect(()=>musicEvidence({samples:[result.value.samples[0],result.value.samples[0]],userPreferences:[]})).toThrow();
    expect(f.command('appendMusicSample',{sample:{...result.value.samples[0],extra:'untrusted'},now:f.timestamp()})).toEqual({ok:false,code:'invalid_data'});
    const db=new Database(f.filename);db.prepare('UPDATE music_samples SET topic=?').run('rock');db.close();
    expect(f.command('readMusicInterest',f.timestamp())).toEqual({ok:false,code:'invalid_data'});
    await f.music.revalidate();expect(f.character.getState().preferences['own.music_topic.jazz']).toBeUndefined();
  }finally{await f.dispose();}
});
it('source deletion removes dependent evidence in the same SQLite transaction and full reset clears its clock',async()=>{
  const f=musicFixture();try{
    await f.send('I like jazz');const pref=await f.repository.read(f.timestamp(),{generation:0});if(!pref.ok)throw new Error('Missing preference');
    f.advance(300000);await f.send("let's discuss jazz");await f.send("let's keep discussing jazz");
    const r=await f.repository.read(f.timestamp(),{generation:0});if(!r.ok)throw new Error('Missing sample');
    const db=new Database(f.filename);db.pragma('foreign_keys=OFF');db.prepare('DELETE FROM messages WHERE id=?').run(r.value.samples[0]!.continuation.assistantMessageId);
    expect(db.prepare('SELECT count(*) n FROM music_samples').get()).toEqual({n:0});
    db.prepare('DELETE FROM messages WHERE id=?').run(pref.value.userPreferences[0]!.source.assistantMessageId);
    expect(db.prepare('SELECT count(*) n FROM music_user_preferences').get()).toEqual({n:0});db.close();
    f.reset();const check=new Database(f.filename);for(const table of ['music_samples','music_user_preferences','music_clock'])expect(check.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);check.close();
  }finally{await f.dispose();}
});
