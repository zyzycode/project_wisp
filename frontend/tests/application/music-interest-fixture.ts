import { vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../src/infrastructure/memory/sqlite-store';
import { musicEvidence } from '../../src/infrastructure/memory/music-validation';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { MusicInterestRuntime } from '../../src/application/services/music-interest-runtime';
import { MemoryHistory } from '../../src/application/services/memory-history';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { CausalExpressionRuntime } from '../../src/application/services/causal-expression-runtime';
import type { IMusicInterestRepository } from '../../src/application/ports/music-interest.interface';
import type { IChatHistoryRepository, MemoryResult } from '../../src/application/ports/memory-repository.interface';
import type { Operation } from '../../src/infrastructure/memory/protocol';
import type { AIProviderRequest, AIProviderResponse } from '../../src/application/ports/ai-provider.interface';
export const musicBase = Date.parse('2026-11-05T10:00:00.000Z');
export async function flushMusic() { for (let i = 0; i < 100; i++) await Promise.resolve(); }
export function musicFixture(draw = 0) {
  vi.useFakeTimers(); vi.setSystemTime(musicBase);
  const dir = mkdtempSync(path.join(os.tmpdir(),'wisp-music-')), filename = path.join(dir,'memory.db');
  let generation = 0, id = 0, monotonic = 0, keep = true, ready = true, fallback = false, quiet = false, role = false, causal = false;
  let store = SqliteMemoryStore.open(filename,new Date(musicBase).toISOString());
  const now = () => monotonic, timestamp = () => new Date().toISOString(), context = () => ({ generation });
  const command = (operation: Operation, payload: unknown = null) => store.execute({ id: 1, generation, operation, payload });
  const empty = (r: MemoryResult<unknown>): MemoryResult<void> => r.ok ? { ok: true, value: undefined } : r;
  const repository: IMusicInterestRepository = { read: async time => { const r = command('readMusicInterest',time); return r.ok ? { ok: true, value: musicEvidence(r.value) } : r; }, appendSample: async (sample,time) => empty(command('appendMusicSample',{sample,now:time})), replaceUserPreference: async (preference,time) => empty(command('replaceMusicPreference',{preference,now:time})) };
  const character = new CharacterStateService({ now: Date.now, monotonicNow: now });
  let history: MemoryHistory;
  const random = vi.fn(() => draw);
  const music = new MusicInterestRuntime({ repository, character, context, now, timestamp, random,
    gates: () => ({ awake: true,quiet,role }), whenSettled: () => history.whenSettled(), scheduler: { setTimeout, clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) } });
  const historyRepository: IChatHistoryRepository = { appendTurn: async turn => empty(command('appendTurn',turn)), getRecent: vi.fn(), closeSession: async () => ({ ok: true,value:undefined }), closeUnfinishedSessions: async () => ({ ok:true,value:undefined }) };
  history = new MemoryHistory({ history: historyRepository, episodes: { append: vi.fn() }, context, createId: () => `source-${++id}`, toTimestamp: timestamp, onFailure: () => {}, onPersisted: (turn,c,source) => music.persisted(turn,source,c) });
  const requests: AIProviderRequest[] = [];
  let resolve: ((value: AIProviderResponse) => void) | undefined, held = false;
  const provider = { supportsMusicTopic: true as const, canIncludeMusicTopic: () => keep, getStatus: async () => ({ kind: ready ? 'ready' as const : 'offline' as const }), generateResponse: async (request: AIProviderRequest): Promise<AIProviderResponse> => {
    requests.push(request);
    if (held) return new Promise(done => { resolve = done; });
    return { requestId: request.requestId,status: fallback ? 'fallback' : 'ok',confidence:1,reply:{text:'A current music discussion.'} };
  } };
  const director=new CausalExpressionRuntime({now,read:()=>({generation,owner:'music-owner',activeRunId:null,consent:false,romanceAllowed:false,deferredInvitation:false,ownGameInterest:'none',emotion:causal?{kind:'irritated',cause:'user_interrupted',activity: 'cursor_game', causeSequence:1,intensity:.3,target:'user'}:null})});
  const runtime = new DialogueRuntime({ causalExpression:director, provider, memory: { music,generation:()=>generation,completed: turn => history.completed(turn) }, getSemanticSleepState: () => 'awake', now, timestamp, createId: () => `message-${++id}`, scheduler: { setTimeout,clearTimeout:h=>clearTimeout(h as ReturnType<typeof setTimeout>) }, getCharacterSnapshot: () => character.getSnapshot(),applyStimulus: s=>character.applyStimulus(s),offerIntent: vi.fn(),beginThinking:()=>{},endThinking:()=>{},transaction:f=>f(),publish:()=>{} });
  runtime.replaceStream('music-stream'); let sequence = 0;
  const send = async (text: string) => { const receipt = runtime.receive({type:'send',text,streamId:'music-stream',conversationId:runtime.getPresentation().conversationId,sequence:++sequence}); await flushMusic(); if (!held) await history.whenSettled(); await flushMusic(); return receipt; };
  return { character,music,history,historyRepository,repository,runtime,provider,requests,random,command,filename,timestamp,now,send,
    advance: (ms: number) => { monotonic += ms; vi.setSystemTime(Date.now()+ms); },
    setDraw: (n: number) => { draw = n; }, setQuiet: (v: boolean) => { quiet=v; },setRole: (v:boolean)=>{role=v;}, setKeep: (v:boolean)=>{keep=v;},setReady:(v:boolean)=>{ready=v;},setFallback:(v:boolean)=>{fallback=v;}, hold:()=>{held=true;},
    setCausal:(v:boolean)=>{causal=v;},
    respond: () => { held=false; const request=requests.at(-1)!; resolve?.({requestId:request.requestId,status:'ok',confidence:1,reply:{text:'Late music reply'}}); },
    reopen: () => { store.close(); store=SqliteMemoryStore.open(filename,timestamp()); },
    reset: () => { music.reset(); generation++; command('clear'); character.resetToDefaults();history.reset(); },
    dispose: async () => { runtime.dispose();music.dispose(); try { await history.whenSettled(); } finally { store.close();rmSync(dir,{recursive:true,force:true});vi.useRealTimers(); } },
  };
}
