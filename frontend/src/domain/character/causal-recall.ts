import type { CausalObservedEvent } from './causal-affect';

export type CausalRecallBucket = 'game.any' | 'game.user_interrupted' | 'game.timeout'
  | 'game.environment_lost' | 'game.completed.user_engaged' | 'game.completed.solitary' | 'contact';

export function recallTokens(text: string): readonly string[] {
  return [...new Set(text.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 8);
}

/** Exact closed facts; this index never infers a user's intention or an emotion. */
export function causalRecallBuckets(event: CausalObservedEvent): readonly CausalRecallBucket[] {
  if (event.cause === 'contact') return event.source === 'user' && event.activity === null ? ['contact'] : [];
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
  const tokens = recallTokens(text);
  const has = (pattern: RegExp) => tokens.some(token => pattern.test(token));
  if (tokens.some(token => ['не', 'нет', 'not', 'never'].includes(token))) return null;
  const game = has(/^(?:game|игр|поигр|play)/u), contact = has(/^(?:коснул|касани|touch)/u);
  if (contact) return game ? null : 'contact';
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
