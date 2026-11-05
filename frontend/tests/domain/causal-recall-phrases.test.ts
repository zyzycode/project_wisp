import { expect, it } from 'vitest';
import { causalRecallBucket, CAUSAL_RECALL_PHRASES } from '../../src/domain/character/causal-recall';
import { CAUSAL_RECALL_CORPUS } from '../infrastructure/memory/causal-recall-corpus';

it.each(CAUSAL_RECALL_CORPUS.filter(row => row.group !== 'baseline'))('$id preserves the approved actor/cause meaning', row => {
  expect(causalRecallBucket(row.text)).toBe(row.expected ? 'game.user_interrupted' : null);
});

it('keeps positive templates bounded, normalized and distinct from quotations/corrections', () => {
  expect(causalRecallBucket('  Я  НЕ ДАЛ ТЕБЕ ЗАКОНЧИТЬ ИГРУ ! ')).toBe('game.user_interrupted');
  for (const query of [
    '"I did not let you finish the game"', '«я оборвал твою игру»', '‘I cut your game short’',
    'я оборвал твою игру, то есть я ее завершил',
    'I cut your game short; actually you interrupted my game',
    'I cut your game short. You interrupted my game.',
    `игра ${'x'.repeat(236)}`,
  ]) expect(causalRecallBucket(query), query).toBeNull();
  expect(causalRecallBucket(`игра ${'x'.repeat(235)}`)).toBe('game.any');
});

it('keeps static phrase and guard tables within4KiB with no stateful regular expressions', () => {
  const patterns = [...CAUSAL_RECALL_PHRASES.positive, CAUSAL_RECALL_PHRASES.quotationOrClause,
    CAUSAL_RECALL_PHRASES.correction, CAUSAL_RECALL_PHRASES.incompatibleActor];
  expect(patterns.every(pattern => !pattern.global && !pattern.sticky)).toBe(true);
  expect(patterns.reduce((bytes, pattern) => bytes + Buffer.byteLength(pattern.source, 'utf8'), 0) + 10).toBeLessThanOrEqual(4096);
});
