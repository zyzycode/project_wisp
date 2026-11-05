import type { CausalObservedEvent } from './causal-affect';

export type CausalRecallBucket = 'game.any' | 'game.user_interrupted' | 'game.timeout'
  | 'book.any' | 'book.completed' | 'book.user_interrupted' | 'book.environment_lost' | 'book.timeout'
  | 'game.environment_lost' | 'game.completed.user_engaged' | 'game.completed.solitary' | 'contact';

/** Immutable, finite phrase/guard tables; patterns are stateless and contain no retained query data. */
export const CAUSAL_RECALL_PHRASES = Object.freeze({
  positive: Object.freeze([
    /^я не (?:дал|дала|позволил|позволила) тебе закончить игру$/u,
    /^я (?:оборвал|оборвала) твою игру$/u,
    /^i did not let you finish the game$/u,
    /^i cut your game short$/u,
    /^i (?:prevented|kept) you from finishing the game$/u,
  ]),
  quotationOrClause: /["'«»“”„‘’‹›;,:.!?]/u,
  correction: /(?:^|\s)(?:but|actually|however|instead|rather|но|однако|вернее|точнее|а)(?:\s|$)|(?:^|\s)то есть(?:\s|$)/u,
  incompatibleActor: /(?:^|\s)([\p{L}]{1,64}) (?:прервал(?:а|и)?|оборвал(?:а|и)?|interrupted|stopped|cut) (?:(?:мою|твою) игру|(?:my|your) game)(?:\s|$)/u,
});

export function recallTokens(text: string): readonly string[] {
  return [...new Set(text.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 8);
}

/** Exact closed facts; this index never infers a user's intention or an emotion. */
export function causalRecallBuckets(event: CausalObservedEvent): readonly CausalRecallBucket[] {
  if (event.cause === 'contact') return event.source === 'user' && event.activity === null ? ['contact'] : [];
  if (event.activity === 'book' && event.activityRunId && event.participation === 'solitary' && event.outcome !== null
    && ['completed', 'user_interrupted', 'environment_lost', 'timeout'].includes(event.cause)) {
    if (event.cause === 'completed' && event.outcome === 'completed' && event.source === 'autonomy' && event.executedMs >= 14000) return ['book.any', 'book.completed'];
    if (event.cause === 'user_interrupted' && event.source === 'user' && event.triggerSequence) return ['book.any', 'book.user_interrupted'];
    if (event.cause === 'environment_lost' || event.cause === 'timeout') return event.source === 'system' ? ['book.any', `book.${event.cause}`] : [];
    return [];
  }
  if (event.activity !== 'cursor_game' || event.outcome === null || event.cause === 'other' || event.cause === 'unknown') return [];
  if (event.cause === 'completed') {
    if (event.outcome !== 'completed') return [];
    return event.participation === 'none' ? ['game.any'] : ['game.any', `game.completed.${event.participation}`];
  }
  if (event.cause === 'user_interrupted' && (event.source !== 'user' || !event.triggerSequence)) return [];
  return ['game.any', `game.${event.cause}`];
}

/** Prefixes are deliberately limited to the approved bilingual baseline. */
export function causalRecallBucket(text: string): CausalRecallBucket | null {
  if (text.length > 240) return null;
  const query = text.normalize('NFC').toLowerCase().trim().replace(/\s+/gu, ' ').replace(/[.!?]$/u, '').trimEnd();
  if (CAUSAL_RECALL_PHRASES.quotationOrClause.test(query) || CAUSAL_RECALL_PHRASES.correction.test(query)) return null;
  const actor = CAUSAL_RECALL_PHRASES.incompatibleActor.exec(query)?.[1];
  if (actor && !['я', 'мы', 'i', 'we'].includes(actor)) return null;
  if (CAUSAL_RECALL_PHRASES.positive.some(pattern => pattern.test(query))) return 'game.user_interrupted';
  const tokens = recallTokens(query);
  const has = (pattern: RegExp) => tokens.some(token => pattern.test(token));
  if (tokens.some(token => ['не', 'нет', 'not', 'never'].includes(token))) return null;
  const game = has(/^(?:game|игр|поигр|play)/u), contact = has(/^(?:коснул|касани|touch)/u);
  if (contact) return game ? null : 'contact';
  const book = has(/^(?:book|книг)/u);
  if (book) {
    if (game) return null;
    const keys: CausalRecallBucket[] = [];
    if (has(/^(?:interrupt|прерва|помеша|stopped)/u)) keys.push('book.user_interrupted');
    if (has(/^(?:timeout|таймаут)/u)) keys.push('book.timeout');
    if (has(/^(?:support|опор)/u) && has(/^(?:lost|потер)/u)) keys.push('book.environment_lost');
    if (has(/^(?:complet|finish|заверш|закон)/u)) keys.push('book.completed');
    return keys.length > 1 ? null : keys[0] ?? 'book.any';
  }
  if (!game) return null;
  const keys: CausalRecallBucket[] = [];
  if (has(/^(?:interrupt|прерва|прервы|помеша|stopped)/u)) keys.push('game.user_interrupted');
  if (has(/^(?:timeout|таймаут)/u) || (tokens.includes('timed') && tokens.includes('out'))) keys.push('game.timeout');
  if (has(/^(?:support|опор)/u) && has(/^(?:lost|потер)/u)) keys.push('game.environment_lost');
  if (has(/^(?:complet|finish|заверш|закон)/u)) {
    if (tokens.some(token => token === 'мы' || token === 'we')) keys.push('game.completed.user_engaged');
    if (has(/^(?:одна|alone|solitary)/u)) keys.push('game.completed.solitary');
  }
  return keys.length > 1 ? null : keys[0] ?? 'game.any';
}
