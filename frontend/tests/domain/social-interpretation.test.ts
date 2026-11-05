import { expect, it } from 'vitest';
import { addInterruptionReport, createInterruptionInterpretation, recognizeInterruptionReport } from '../../src/domain/character/social-interpretation';
import { appraiseCausalEvent, createCausalAffectState, decayCausalAffect, reappraiseInterruption } from '../../src/domain/character/causal-affect';

const episode = { appRunId: 'app', sequence: 2, revision: 1 as const, occurredAt: '2026-11-05T10:00:00.000Z', source: 'user' as const,
  activityRunId: 'game', activity: 'cursor_game' as const, outcome: 'cancelled' as const, cause: 'user_interrupted' as const,
  triggerSequence: 1, executedMs: 2000, participation: 'user_engaged' as const };
const accidental = { conversationSessionId: 'session', userMessageId: 'u1', revision: 1 as const, report: 'accidental' as const };

it('recognizes only standalone explicit self-reports with the approved RU/EN normalization', () => {
  for (const text of ['Я случайно прервал игру.', ' я случайно прервала игру! ', 'I INTERRUPTED THE GAME BY ACCIDENT?']) expect(recognizeInterruptionReport(text)).toBe('accidental');
  for (const text of ['я намеренно прервал игру', 'Я НАМЕРЕННО ПРЕРВАЛА ИГРУ.', 'i interrupted the game deliberately']) expect(recognizeInterruptionReport(text)).toBe('deliberate');
  for (const text of ['извини', 'я случайно прервал игру!!', '«я случайно прервал игру»', 'он случайно прервал игру', 'я случайно прервал игру, извини', 'i interrupted the game by accident and I am sorry']) expect(recognizeInterruptionReport(text)).toBeNull();
});

it('keeps facts unknown until one distinct report and preserves both contradictory sources without counting repetition', () => {
  const initial = createInterruptionInterpretation(episode, 1)!;
  expect(initial.status).toBe('unknown');
  expect(createInterruptionInterpretation({ ...episode, source: 'unknown' }, 1)).toBeNull();
  const reported = addInterruptionReport(initial, accidental);
  expect(reported).toMatchObject({ revision: 2, status: 'reported_accidental', reports: [accidental], episode: initial.episode, expiresAt: initial.expiresAt });
  expect(addInterruptionReport(reported, accidental)).toBe(reported);
  expect(addInterruptionReport(reported, { ...accidental, userMessageId: 'u-same-report' })).toBe(reported);
  const opposite = { ...accidental, userMessageId: 'u2', report: 'deliberate' as const };
  const contradicted = addInterruptionReport(reported, opposite);
  expect(contradicted).toMatchObject({ revision: 3, status: 'contradicted', reports: [accidental, opposite] });
  expect(addInterruptionReport(contradicted, { ...opposite, userMessageId: 'u3' })).toBe(contradicted);
});

it('reappraises the same existing cause once, reverses only the report factor, and never resurrects cleared or replaced affect', () => {
  const initial = appraiseCausalEvent(createCausalAffectState(), episode, 0);
  const half = reappraiseInterruption(initial, 2, 'reported_accidental', 10000);
  expect(half.emotion!.intensity).toBeCloseTo(.1 * 2 ** (-10000 / 30000));
  expect(reappraiseInterruption(half, 2, 'reported_accidental', 10000)).toEqual(half);
  const contradicted = reappraiseInterruption(half, 2, 'contradicted', 20000);
  expect(contradicted.emotion!.intensity).toBeCloseTo(.2 * 2 ** (-20000 / 30000));
  const repeated = appraiseCausalEvent(initial, { ...episode, sequence: 4, triggerSequence: 3 }, 0);
  const reported = reappraiseInterruption(repeated, 4, 'reported_accidental', 0);
  const independentRelief = { ...reported, baselineIntensity: reported.baselineIntensity! * .5, emotion: { ...reported.emotion!, intensity: reported.emotion!.intensity * .5 } };
  expect(reappraiseInterruption(independentRelief, 4, 'unknown', 0).emotion!.intensity).toBeCloseTo(.15);
  const expired = decayCausalAffect(decayCausalAffect(initial, 60000), 90000);
  expect(expired.emotion).toBeNull();
  expect(reappraiseInterruption(expired, 2, 'contradicted', 90000).emotion).toBeNull();
  const replaced = appraiseCausalEvent(initial, { ...episode, sequence: 4, triggerSequence: 3 }, 1000);
  expect(reappraiseInterruption(replaced, 2, 'reported_accidental', 1000)).toEqual(replaced);
  expect(reappraiseInterruption(half, 2, 'contradicted', -1)).toBe(half);
});
