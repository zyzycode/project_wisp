import type { IMusicInterestRepository } from '../../application/ports/music-interest.interface';
import { musicEvidence } from './music-validation';
import type { ILifeHistoryReader } from '../../application/ports/life-history.interface';
import { lifeWindow } from './life-history-validation';
import { deferredInvitation } from './deferred-invitation-validation';
import { socialInterpretation } from './social-interpretation-validation';
import { motivationRecord } from './motivation-validation';
import type { IMotivationRepository } from '../../application/ports/motivation.interface';
import type { ISocialInterpretationRepository } from '../../application/ports/social-interpretation.interface';
import type { IDeferredGameInvitationRepository } from '../../application/ports/causal-life.interface';
import type { ICausalLifeRepository } from '../../application/ports/causal-life.interface';
import type { ICausalLifeRecallReader } from '../../application/ports/causal-recall.interface';
import { causalRecallPage } from './causal-recall-validation';
import { causalEpisode } from './causal-life-validation';
import type { IRoutineObservationRepository } from '../../application/ports/routine-observation.port';
import { routineIdentity, routineStatus } from './routine-validation';
import type { IInterestThreadRepository } from '../../application/ports/interest-thread.interface';
import { topicRead, topicReceipt, topicCapture } from './interest-thread-validation';
import type { ISummarySourceReader } from '../../application/ports/summary';
import { summarySnapshot } from './summary-source-reader';
import { itemReceipt, itemPage, itemCandidates } from './item-validation';
import type { IMemoryItemsRepository, IMemoryItemRecallReader } from '../../application/ports/memory-items.interface';
import type { IGameEpisodeReader } from '../../application/ports/memory-knowledge.interface';
import type { ICharacterStateRepository, IChatHistoryRepository, IClearMemoryStore, IGameEpisodeRepository, IUserFactsRepository, MemoryResult, MemoryOperationContext } from '../../application/ports/memory-repository.interface';
import type { MemoryWorkerClient } from './worker-client';
import type { Operation } from './protocol';
import * as v from './validation';

function nothing(value: unknown): void { if (value !== undefined) throw new v.MemoryDataError('invalid_data'); }
function list<T>(value: unknown, parse: (item: unknown) => T): readonly T[] {
  if (!Array.isArray(value) || value.length > 100) throw new v.MemoryDataError('invalid_data');
  return value.map(parse);
}
export interface MemoryAdapters {
  readonly music: IMusicInterestRepository;
  readonly lifeHistory: ILifeHistoryReader;
  readonly motivation: IMotivationRepository;
  readonly socialInterpretation: ISocialInterpretationRepository;
  readonly deferredInvitation: IDeferredGameInvitationRepository;
  readonly causalRecall: ICausalLifeRecallReader;
  readonly itemRecall: IMemoryItemRecallReader;
  readonly causalLife: ICausalLifeRepository;
  readonly routine: IRoutineObservationRepository;
  readonly interestThread: IInterestThreadRepository;
  readonly summarySources: ISummarySourceReader;
  readonly items: IMemoryItemsRepository;
  readonly history: IChatHistoryRepository;
  readonly facts: IUserFactsRepository;
  readonly episodes: IGameEpisodeRepository;
  readonly gameReader: IGameEpisodeReader;
  readonly character: ICharacterStateRepository;
  readonly clear: IClearMemoryStore;
}
export function createMemoryAdapters(client: MemoryWorkerClient): MemoryAdapters {
  async function call<T>(operation: Operation, payload: unknown, context: MemoryOperationContext, parse: (value: unknown) => T): Promise<MemoryResult<T>> {
    const result = await client.request(operation, payload, context.generation);
    if (!result.ok) return result;
    try { return { ok: true, value: parse(result.value) }; } catch { return { ok: false, code: 'invalid_data' }; }
  }
  return {
    music: { read: (now,c) => call('readMusicInterest',now,c,musicEvidence), appendSample: (sample,now,c) => call('appendMusicSample',{sample,now},c,nothing), replaceUserPreference: (preference,now,c) => call('replaceMusicPreference',{preference,now},c,nothing) },
    lifeHistory: { readWindow: (query, c) => call('readLifeWindow', query, c, lifeWindow) },
    motivation: {
      restore: (now,c) => call('restoreMotivation',now,c,value => value === null ? null : motivationRecord(value)),
      read: (now,c) => call('readMotivation',now,c,value => value === null ? null : motivationRecord(value)),
      replace: (value,expectedRevision,c) => call('replaceMotivation',{value,expectedRevision},c,nothing),
    },
    socialInterpretation: {
      read: (now,c) => call('readSocialInterpretation',now,c,value => value === null ? null : socialInterpretation(value)),
      replace: (value,expectedRevision,now,c) => call('replaceSocialInterpretation',{value,expectedRevision,now},c,nothing),
      clear: (expectedRevision,c) => call('clearSocialInterpretation',expectedRevision,c,nothing),
    },
    deferredInvitation: {
      create: (invite,c) => call('createDeferredInvitation',invite,c,nothing),
      read: (now,c) => call('readDeferredInvitation',now,c,value => value === null ? null : deferredInvitation(value)),
      claim: (id,now,c) => call('claimDeferredInvitation',{id,now},c,value => { if (typeof value !== 'boolean') throw new v.MemoryDataError('invalid_data'); return value; }),
      finish: (id,state,c) => call('finishDeferredInvitation',{id,state},c,nothing),
    },
    causalRecall: { find: (query, c) => call('findCausalLife', query, c, causalRecallPage) },
    itemRecall: { find: (tokens, c) => call('findMemoryItems', tokens, c, itemCandidates) },
    causalLife: { append: (episode, c) => call('appendCausalLife', episode, c, nothing), getRecent: (limit, c) => call('recentCausalLife', limit, c, value => list(value, causalEpisode)), resolveSources: (sources, c) => call('resolveCausalLife', sources, c, value => list(value, causalEpisode)) },
    routine: { begin: (input,c) => call('beginRoutine',input,c,routineIdentity), append: (input,c) => call('appendRoutine',input,c,nothing), readStatus: c => call('readRoutineStatus',null,c,routineStatus) },
    interestThread: {
      read: c => call('readInterestThread', null, c, topicRead),
      mutate: (command, c) => call('mutateInterestThread', command, c, topicReceipt),
      claim: (command, c) => call('claimInterestThread', command, c, topicCapture),
      captureReply: (command, c) => call('captureInterestThreadReply', command, c, topicCapture),
    },
    summarySources: { recent: c => call('summaryRecent', null, c, summarySnapshot), exact: (sources, c) => call('summaryExact', sources, c, summarySnapshot) },
    items: {
      confirm: (command, c) => call('mutateMemoryItem', command, c, itemReceipt),
      update: (command, c) => call('mutateMemoryItem', command, c, itemReceipt),
      withdraw: (command, c) => call('mutateMemoryItem', command, c, itemReceipt),
      delete: (command, c) => call('mutateMemoryItem', command, c, itemReceipt),
      list: (query, c) => call('listMemoryItems', query, c, itemPage),
    },
    history: {
      appendTurn: (turn, c) => call('appendTurn', turn, c, nothing),
      getRecent: (limit, c) => call('getRecent', limit, c, value => list(value, v.message)),
      closeSession: (sessionId, endedAt, c) => call('closeSession', { sessionId, endedAt }, c, nothing),
      closeUnfinishedSessions: (endedAt, c) => call('closeUnfinishedSessions', endedAt, c, nothing),
    },
    facts: {
      upsert: (fact, c) => call('upsertFact', fact, c, v.fact),
      removeByKey: (key, c) => call('removeFact', key, c, nothing),
      list: (limit, c) => call('listFacts', limit, c, value => list(value, v.fact)),
    },
    gameReader: { getRecent: (limit, c) => call('getRecentEpisodes', limit, c, value => list(value, v.episode)) },
    episodes: { append: (episode, c) => call('appendEpisode', episode, c, nothing) },
    character: {
      load: c => call('loadSnapshot', null, c, value => value === null ? null : v.snapshot(value)),
      save: (snapshot, c) => call('saveSnapshot', snapshot, c, nothing),
    },
    clear: { clearUserMemory: c => call('clear', null, c, nothing) },
  };
}
