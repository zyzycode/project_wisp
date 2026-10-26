import type { IRoutineObservationRepository } from '../../application/ports/routine-observation.port';
import { routineIdentity, routineStatus } from './routine-validation';
import type { IBeveragePreferencesRepository } from '../../application/ports/memory-beverage.interface';
import { beverageRead, beverageReceipt } from './beverage-validation';
import type { IInterestThreadRepository } from '../../application/ports/interest-thread.interface';
import { topicRead, topicReceipt, topicCapture } from './interest-thread-validation';
import type { ISummarySourceReader } from '../../application/ports/summary';
import { summarySnapshot } from './summary-source-reader';
import { itemReceipt, itemPage } from './item-validation';
import type { IMemoryItemsRepository } from '../../application/ports/memory-items.interface';
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
  readonly routine: IRoutineObservationRepository;
  readonly beverage: IBeveragePreferencesRepository;
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
    routine: { begin: (input,c) => call('beginRoutine',input,c,routineIdentity), append: (input,c) => call('appendRoutine',input,c,nothing), readStatus: c => call('readRoutineStatus',null,c,routineStatus) },
    beverage: { read: c => call('readBeverage', null, c, beverageRead), mutate: (command, c) => call('mutateBeverage', command, c, beverageReceipt) },
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
