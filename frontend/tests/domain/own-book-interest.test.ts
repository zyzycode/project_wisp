import { expect, it } from 'vitest';
import { isOwnBookSource, learnOwnBookInterest, reflectOwnBookInterest, type OwnBookEpisode } from '../../src/domain/character/own-book-interest';
import { createOwnInterestGate, learnOwnGameInterest, type OwnGameEpisode } from '../../src/domain/character/own-game-interest';
import type { CausalSourceReference, PreferenceTrack } from '../../src/domain/character/types';

const episode = (sequence: number): OwnBookEpisode => ({ appRunId: 'app', sequence, revision: 1, source: 'autonomy', terminalReason: null,
  triggerSequence: null, activity: 'book', activityRunId: `book-${sequence}`, cause: 'completed', outcome: 'completed', participation: 'solitary', executedMs: 14_000 });

it('shares the cursor learning opportunity and never replays a skipped book', () => {
  const game: OwnGameEpisode = { ...episode(1), activity: 'cursor_game', participation: 'user_engaged', executedMs: 1000 };
  const learnedGame = learnOwnGameInterest(undefined, [], createOwnInterestGate(0), game, 300_000);
  expect(learnedGame.accepted).toBe(true);
  const skippedBook = learnOwnBookInterest(undefined, [], learnedGame.gate, episode(2), 300_000, 'app');
  expect(skippedBook.accepted).toBe(false);
  expect(learnOwnBookInterest(undefined, [], skippedBook.gate, episode(2), 600_000, 'app').accepted).toBe(false);
  const learnedBook = learnOwnBookInterest(undefined, [], skippedBook.gate, episode(3), 600_000, 'app');
  expect(learnedBook.accepted).toBe(true);
  expect(learnedBook.track).toEqual({ value: 1, samples: 1, confidence: 1 / 7 });
  expect(learnOwnGameInterest(learnedGame.track, learnedGame.sources, learnedBook.gate, { ...game, sequence: 4 }, 600_000).accepted).toBe(false);
  expect(learnedGame.sources).toEqual([{ appRunId: 'app', sequence: 1, revision: 1 }]);
});

it('starts with a full five-minute delay and binds learning to the current acknowledged app run', () => {
  const gate = createOwnInterestGate(0);
  expect(learnOwnBookInterest(undefined, [], gate, episode(1), 299_999, 'app').accepted).toBe(false);
  expect(learnOwnBookInterest(undefined, [], gate, episode(1), 300_000, 'app').accepted).toBe(true);
  expect(learnOwnBookInterest(undefined, [], gate, episode(1), 300_000, 'new-app').accepted).toBe(false);
  const e = episode(1);
  for (const change of [{ activity: 'cursor_game' }, { participation: 'user_engaged' }, { outcome: 'cancelled' }, { cause: 'other' },
    { source: 'user' }, { triggerSequence: 1 }, { terminalReason: 'user_interaction' }, { executedMs: 13_999 },
    { executedMs: Infinity }, { executedMs: 600_001 }, { activityRunId: '' }, { appRunId: ' ' }]) {
    expect(isOwnBookSource({ ...e, ...change })).toBe(false);
  }
});

it('bounds references and tracks, requiring distinct proven book sources for reflection', () => {
  let gate = createOwnInterestGate(0);
  let track: PreferenceTrack | undefined;
  let refs: readonly CausalSourceReference[] = [];
  for (let sequence = 1; sequence <= 25; sequence++) {
    const result = learnOwnBookInterest(track, refs, gate, episode(sequence), sequence * 300_000, 'app');
    expect(result.accepted).toBe(true);
    ({ gate, track, sources: refs } = result);
  }
  expect(track).toEqual({ value: 25, samples: 25, confidence: 25 / 31 });
  expect(refs).toHaveLength(20);
  expect(refs[0]?.sequence).toBe(6);
  expect(reflectOwnBookInterest(track, refs).band).toBe('established');
  expect(reflectOwnBookInterest(track, refs.slice(0, 6)).band).toBe('emerging');
  expect(reflectOwnBookInterest(track, refs.slice(0, 5))).toEqual({ band: 'none', multiplier: 1, sources: [] });
  expect(reflectOwnBookInterest(track, Array.from({ length: 20 }, () => refs[0]!)).band).toBe('none');
  expect(reflectOwnBookInterest({ value: 100, samples: 1000, confidence: 0 }, refs).multiplier).toBe(1.2);
  expect(reflectOwnBookInterest({ value: 100, samples: 1, confidence: 1 }, refs).multiplier).toBe(1);
  expect(reflectOwnBookInterest(track, []).multiplier).toBe(1);
  expect(learnOwnBookInterest({ value: 100, samples: 1000, confidence: 1 }, refs, gate, episode(26), 7_800_000, 'app').track)
    .toEqual({ value: 100, samples: 1000, confidence: 1000 / 1006 });
});
