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
  readonly history: IChatHistoryRepository;
  readonly facts: IUserFactsRepository;
  readonly episodes: IGameEpisodeRepository;
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
    episodes: { append: (episode, c) => call('appendEpisode', episode, c, nothing) },
    character: {
      load: c => call('loadSnapshot', null, c, value => value === null ? null : v.snapshot(value)),
      save: (snapshot, c) => call('saveSnapshot', snapshot, c, nothing),
    },
    clear: { clearUserMemory: c => call('clear', null, c, nothing) },
  };
}
