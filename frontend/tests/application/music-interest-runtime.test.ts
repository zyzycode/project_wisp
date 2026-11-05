import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { flushMusic, musicFixture } from './music-interest-fixture';
import { musicEvidence } from '../../src/infrastructure/memory/music-validation';
import { projectCharacterMemory, restoreCharacterMemory } from '../../src/application/services/character-memory-snapshot';
afterEach(() => vi.useRealTimers());
it('learns only from local intention plus two actual published persisted pairs, independently of user taste', async () => {
  const histories = [];
  for (const draw of [0,1]) {
    const f = musicFixture(draw);
    try {
      await f.send('I like rock'); expect(f.character.getState().preferences['own.music_topic.rock']).toBeUndefined();
      f.advance(300000);
      for (let i=0;i<6;i++) { if(i)f.advance(86400000); await f.send("let's discuss jazz"); await f.send("let's keep discussing jazz"); expect(f.runtime.getPresentation().turn.phase).toBe('completed'); }
      const evidence = await f.repository.read(f.timestamp(),{generation:0}); expect(evidence.ok).toBe(true);
      expect(evidence.ok && evidence.value.samples.length).toBe(draw===0?6:0);
      expect(evidence.ok && evidence.value.userPreferences[0]).toMatchObject({topic:'rock',disposition:'like'});
      expect(f.character.getState().preferences['own.music_topic.jazz']?.samples).toBe(draw===0?6:undefined);
      await f.send("let's discuss jazz");
      expect(f.requests.at(-1)?.musicTopic).toMatchObject({ scope:'text_discussion',topic:'jazz',characterInterest:draw===0?'emerging':'unknown',userPreference:{topic:'rock',disposition:'like'} });
      histories.push(f.character.getState());
      const snapshot=projectCharacterMemory(f.character.getState(),f.timestamp()); f.reopen();
      f.character.replaceRestoredState(restoreCharacterMemory(snapshot,f.character.createDefaults(),f.now())); f.music.invalidate();
      expect(f.character.getState().preferences['own.music_topic.jazz']).toBeUndefined(); await f.music.revalidate();
      expect(f.character.getState().preferences['own.music_topic.jazz']?.samples).toBe(draw===0?6:undefined);
    } finally { await f.dispose(); }
  }
  expect(histories[0]!.relationship).toEqual(histories[1]!.relationship);
  expect(histories[0]!.personality).toEqual(histories[1]!.personality);
});
it.each(['intervening','fallback','dropped','offline','role','quiet'] as const)('does not learn after %s and never rerolls an ineligible intention', async mode => {
  const f=musicFixture();try {
    f.advance(300000); if(mode==='fallback')f.setFallback(true);if(mode==='dropped')f.setKeep(false);if(mode==='offline')f.setReady(false);if(mode==='role')f.setRole(true);if(mode==='quiet')f.setQuiet(true);
    await f.send("let's discuss jazz");
    if(mode==='intervening')await f.send('Another subject');
    f.setFallback(false);f.setKeep(true);f.setReady(true);f.setRole(false);f.setQuiet(false);
    await f.send("let's keep discussing jazz");
    expect(f.character.getState().preferences['own.music_topic.jazz']).toBeUndefined();
    if(mode==='quiet'||mode==='role')expect(f.random).not.toHaveBeenCalled();
  }finally{await f.dispose();}
});
it('prunes source corrections, invalidates every late consumer and clears all records on full reset', async()=>{
  const f=musicFixture();try{
    f.advance(300000);await f.send("let's discuss jazz");await f.send("let's keep discussing jazz");
    expect(f.character.getState().preferences['own.music_topic.jazz']?.samples).toBe(1);
    const read=await f.repository.read(f.timestamp(),{generation:0});if(!read.ok)throw new Error('Missing evidence');
    f.music.invalidate();const db=new Database(f.filename);db.prepare('UPDATE messages SET content=? WHERE id=?').run('corrected',read.value.samples[0]!.opening.userMessageId);db.close();
    await f.music.revalidate();expect(f.character.getState().preferences['own.music_topic.jazz']).toBeUndefined();
    f.hold();await f.send("let's discuss jazz");f.reset();f.respond();await flushMusic();
    expect(f.runtime.getPresentation().turn.phase).toBe('idle');expect(f.command('readMusicInterest',f.timestamp())).toMatchObject({ok:true,value:{samples:[],userPreferences:[]}});
  }finally{await f.dispose();}
});
it('keeps current explicit preferences distinct and does not resurrect an older source after replacement or deletion', async()=>{
  const f=musicFixture();try{
    await f.send('I like rock');const first=await f.repository.read(f.timestamp(),{generation:0});if(!first.ok)throw new Error('Missing preference');
    f.advance(1);await f.send('I dislike rock');expect(f.runtime.getPresentation().turn.phase).toBe('completed');const latest=await f.repository.read(f.timestamp(),{generation:0});if(!latest.ok)throw new Error('Missing preference');
    expect(latest.value.userPreferences[0]?.disposition).toBe('dislike');
    const db=new Database(f.filename);db.prepare('UPDATE messages SET content=? WHERE id=?').run('withdrawn',latest.value.userPreferences[0]!.source.userMessageId);db.close();
    expect((await f.repository.replaceUserPreference(first.value.userPreferences[0]!,f.timestamp(),{generation:0})).ok).toBe(true);
    const result=f.command('readMusicInterest',f.timestamp());expect(result.ok&&musicEvidence(result.value).userPreferences).toEqual([]);
  }finally{await f.dispose();}
});
it('caps retained samples at twelve and still rejects old source replay after eviction and SQLite reopen', async()=>{
  const f=musicFixture();try{
    f.advance(300000);let first: import('../../src/application/ports/music-interest.interface').MusicDiscussionSample | undefined;
    for(let i=0;i<13;i++){
      if(i)f.advance(86400000);await f.send("let's discuss jazz");await f.send("let's keep discussing jazz");
      if(!i){const r=await f.repository.read(f.timestamp(),{generation:0});if(r.ok)first=r.value.samples[0];}
    }
    expect(f.character.getState().preferences['own.music_topic.jazz']).toEqual({value:24,samples:12,confidence:2/3});
    f.reopen();expect(first).toBeDefined();expect(await f.repository.appendSample(first!,f.timestamp(),{generation:0})).toEqual({ok:true,value:undefined});
    const read=await f.repository.read(f.timestamp(),{generation:0});expect(read.ok&&read.value.samples).toHaveLength(12);
    f.advance(30*86400000);await f.music.revalidate();expect(f.character.getState().preferences['own.music_topic.jazz']).toBeUndefined();
  }finally{await f.dispose();}
});
it('takes one draw per request and keeps a timed-out source read bounded without late cache publication',async()=>{
  const f=musicFixture();try{
    f.advance(300000);const admission=f.music.beginTurn('one',"let's discuss jazz");
    const gates={causal:false,otherBundle:false,deadlineMs:f.now()+200};
    expect(await f.music.prepare(admission,0,gates)).toBeDefined();expect(await f.music.prepare(admission,0,gates)).toBeDefined();expect(f.random).toHaveBeenCalledTimes(1);
    let finish: ((value: Awaited<ReturnType<typeof f.repository.read>>) => void) | undefined;
    const read=vi.spyOn(f.repository,'read').mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=f.music.revalidate();await flushMusic();await vi.advanceTimersByTimeAsync(200);await pending;
    await f.music.revalidate();expect(read).toHaveBeenCalledTimes(1);
    finish?.({ok:true,value:{samples:[],userPreferences:[]}});await flushMusic();
    expect(f.character.getState().preferences['own.music_topic.jazz']).toBeUndefined();
  }finally{await f.dispose();}
});
it('omits on wall-clock rollback without destroying previously acknowledged music evidence',async()=>{
  const f=musicFixture();try{
    f.advance(300000);await f.send("let's discuss jazz");await f.send("let's keep discussing jazz");
    const time=f.timestamp();const clockDb=new Database(f.filename);expect(clockDb.prepare('SELECT * FROM music_clock').get()).toEqual({id:1,last_clock:time});clockDb.close();vi.setSystemTime(Date.now()-1);await f.music.revalidate();
    expect(f.character.getState().preferences['own.music_topic.jazz']).toBeUndefined();
    expect(f.command('readMusicInterest',f.timestamp())).toEqual({ok:false,code:'conflict'});
    vi.setSystemTime(new Date(time));expect(f.timestamp()).toBe(time);expect(f.command('readMusicInterest',f.timestamp())).toMatchObject({ok:true,value:{samples:[expect.any(Object)]}});await f.music.revalidate();expect(f.character.getState().preferences['own.music_topic.jazz']?.samples).toBe(1);
  }finally{await f.dispose();}
});
it('enforces one topic sample per UTC day and consumes the shared five-minute attempt gate on failed writes',async()=>{
  const f=musicFixture();try{
    f.advance(300000);await f.send("let's discuss jazz");await f.send("let's keep discussing jazz");
    f.advance(300000);await f.send("let's discuss jazz");await f.send("let's keep discussing jazz");
    expect(f.character.getState().preferences['own.music_topic.jazz']?.samples).toBe(1);
    f.advance(300000);const append=vi.spyOn(f.repository,'appendSample').mockResolvedValueOnce({ok:false,code:'unavailable'});
    await f.send("let's discuss rock");await f.send("let's keep discussing rock");
    f.advance(1);await f.send("let's discuss classical music");await f.send("let's keep discussing classical music");
    expect(append).toHaveBeenCalledTimes(1);expect(f.character.getState().preferences['own.music_topic.rock']).toBeUndefined();
    f.advance(300000);await f.send("let's discuss classical music");await f.send("let's keep discussing classical music");
    expect(append).toHaveBeenCalledTimes(2);expect(f.character.getState().preferences['own.music_topic.classical']?.samples).toBe(1);
  }finally{await f.dispose();}
});
it('drops a pending consumer after source invalidation and isolates local intention from provider request mutation',async()=>{
  const f=musicFixture();try{
    f.advance(300000);f.hold();await f.send("let's discuss jazz");f.music.invalidate();const before=f.character.getState();
    f.respond();await flushMusic();await f.history.whenSettled();expect(f.runtime.getPresentation().turn.phase).toBe('idle');expect(f.character.getState()).toEqual(before);
    vi.spyOn(f.provider,'generateResponse').mockImplementation(async request=>{ if(request.musicTopic)Reflect.set(request.musicTopic,'characterInterest','established');return{requestId:request.requestId,status:'ok',confidence:1,reply:{text:'A model opinion is not evidence.'}}; });
    await f.send("let's discuss jazz");expect(f.runtime.getPresentation().turn.phase).toBe('completed');await f.send("let's keep discussing jazz");
    expect(f.character.getState().preferences['own.music_topic.jazz']?.samples).toBe(1);
  }finally{await f.dispose();}
});
it('waits a full fresh learning window and never catches up from earlier startup discussion pairs',async()=>{
  const f=musicFixture();try{
    await f.send("let's discuss jazz");await f.send("let's keep discussing jazz");expect(f.character.getState().preferences['own.music_topic.jazz']).toBeUndefined();
    f.advance(299999);await f.send("let's discuss jazz");await f.send("let's keep discussing jazz");expect(f.character.getState().preferences['own.music_topic.jazz']).toBeUndefined();
    f.advance(1);await f.send("let's discuss jazz");await f.send("let's keep discussing jazz");expect(f.character.getState().preferences['own.music_topic.jazz']?.samples).toBe(1);
  }finally{await f.dispose();}
});
it('causal Director override and the exact continuation deadline prevent a new own-interest sample',async()=>{
  for(const mode of ['causal','expired'] as const){const f=musicFixture();try{
    f.advance(300000);await f.send("let's discuss jazz");
    if(mode==='causal')f.setCausal(true);else f.advance(300000);
    await f.send("let's keep discussing jazz");expect(f.character.getState().preferences['own.music_topic.jazz']).toBeUndefined();
    if(mode==='causal'){expect(f.requests.at(-1)?.causalExpression).toBeDefined();expect(f.requests.at(-1)?.musicTopic).toBeUndefined();}
  }finally{await f.dispose();}}
});
it('a late opening acknowledgement cannot create a continuation slot after the next user input',async()=>{
  const f=musicFixture();try{
    f.advance(300000);let release: (()=>void)|undefined;
    const barrier=new Promise<void>(resolve=>{release=resolve;}),append=f.historyRepository.appendTurn;
    vi.spyOn(f.historyRepository,'appendTurn').mockImplementationOnce(async(turn,c)=>{await barrier;return append(turn,c);});
    const first=f.send("let's discuss jazz");await flushMusic();
    const second=f.send("let's keep discussing jazz");await flushMusic();await vi.advanceTimersByTimeAsync(200);
    release?.();await first;await second;expect(f.character.getState().preferences['own.music_topic.jazz']).toBeUndefined();
  }finally{await f.dispose();}
});
it('an optional adapter rejection never poisons the canonical dialogue-history queue',async()=>{
  const f=musicFixture();try{
    f.advance(300000);await f.send("let's discuss jazz");vi.spyOn(f.repository,'appendSample').mockRejectedValueOnce(new Error('Optional adapter failed'));
    await expect(f.send("let's keep discussing jazz")).resolves.toMatchObject({status:'accepted'});
    await expect(f.send('An ordinary later message')).resolves.toMatchObject({status:'accepted'});
    expect(f.runtime.getPresentation().turn.phase).toBe('completed');expect(f.character.getState().preferences['own.music_topic.jazz']).toBeUndefined();
  }finally{await f.dispose();}
});
it('dispose cancels its proof deadline immediately and no late source result restores the cache',async()=>{
  const f=musicFixture();try{
    let finish: ((value: Awaited<ReturnType<typeof f.repository.read>>) => void) | undefined;
    vi.spyOn(f.repository,'read').mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=f.music.revalidate();await flushMusic();expect(vi.getTimerCount()).toBe(1);
    f.music.dispose();expect(vi.getTimerCount()).toBe(0);await pending;
    finish?.({ok:true,value:{samples:[],userPreferences:[]}});await flushMusic();expect(f.character.getState().preferences['own.music_topic.jazz']).toBeUndefined();
  }finally{await f.dispose();}
});
