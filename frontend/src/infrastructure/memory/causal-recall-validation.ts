import type { CausalRecallKey, CausalRecallQuery, CausalRecallPage } from '../../application/ports/causal-recall.interface';
import { causalEpisode, causalSources } from './causal-life-validation';
import { integer, MemoryDataError, record, timestamp } from './validation-primitives';

const keys: readonly CausalRecallKey[] = ['game.any', 'game.user_interrupted', 'game.timeout', 'game.environment_lost', 'game.completed.user_engaged', 'game.completed.solitary', 'contact', 'book.any', 'book.completed', 'book.user_interrupted', 'book.environment_lost', 'book.timeout'];
export function causalRecallKey(value: unknown): CausalRecallKey {
  if (typeof value !== 'string' || !keys.includes(value as CausalRecallKey)) throw new MemoryDataError('invalid_data');
  return value as CausalRecallKey;
}
export function causalRecallQuery(value: unknown): CausalRecallQuery {
  const r = record(value); record(r, Object.hasOwn(r, 'exclude') ? ['key', 'before', 'exclude'] : ['key', 'before']);
  return { key: causalRecallKey(r.key), before: timestamp(r.before), ...(r.exclude === undefined ? {} : { exclude: causalSources([r.exclude])[0]! }) };
}
export function causalRecallPage(value: unknown): CausalRecallPage {
  const r = record(value, ['candidates', 'coverage', 'examined', 'fetched']);
  if (!Array.isArray(r.candidates) || r.candidates.length > 16 || (r.coverage !== 'complete' && r.coverage !== 'index_building')) throw new MemoryDataError('invalid_data');
  return { candidates: r.candidates.map(value => {
    const c = record(value, ['source', 'episode', 'match']);
    const source = causalSources([c.source])[0]!, episode = causalEpisode(c.episode);
    if (c.match !== 'exact_causal_bucket' || source.appRunId !== episode.appRunId || source.sequence !== episode.sequence) throw new MemoryDataError('invalid_data');
    return { source, episode, match: 'exact_causal_bucket' as const };
  }), coverage: r.coverage, examined: integer(r.examined, 0, 16), fetched: integer(r.fetched, 0, 16) };
}
