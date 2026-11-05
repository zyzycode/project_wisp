import { expect, it } from 'vitest';
import { BOOK_SESSION_TUNING, bookSatiationMultiplier, isBookActivityEligible, isBookDeadlineReached,
  isLocalBookAdmission, scoreBookActivity, type BookActivityEligibility } from '../../src/domain/behavior/book-activity-policy';

const gates: BookActivityEligibility = { canBook: true, awake: true, energy: 35, boredom: 30, comfort: 70,
  quiet: false, supportMode: false, menuOpen: false, forcedMotion: false, criticalNeed: false, activeOwner: false,
  stableSupport: true, cooldownReady: true };

it('uses inclusive Need thresholds and excludes invalid required values', () => {
  expect(isBookActivityEligible(gates)).toBe(true);
  for (const change of [{ energy: 34.999 }, { boredom: 29.999 }, { comfort: 70.001 }, { energy: 101 }, { boredom: -1 },
    { energy: NaN }, { boredom: Infinity }, { comfort: -Infinity }]) {
    expect(isBookActivityEligible({ ...gates, ...change })).toBe(false);
    expect(scoreBookActivity({ ...gates, ...change }, .5, 1.2, 0)).toBe(0);
  }
});

it('requires every existing hard gate and exclusively local Utility admission', () => {
  for (const key of ['canBook', 'awake', 'stableSupport', 'cooldownReady'] as const) {
    expect(isBookActivityEligible({ ...gates, [key]: false })).toBe(false);
  }
  for (const key of ['quiet', 'supportMode', 'menuOpen', 'forcedMotion', 'criticalNeed', 'activeOwner'] as const) {
    expect(isBookActivityEligible({ ...gates, [key]: true })).toBe(false);
  }
  expect(isLocalBookAdmission('timer', 'local_utility')).toBe(true);
  for (const source of ['user', 'provider', 'autonomy', 'system']) expect(isLocalBookAdmission(source, 'local_utility')).toBe(false);
  expect(isLocalBookAdmission('timer', undefined)).toBe(false);
  expect(isLocalBookAdmission('timer', 'provider_reply')).toBe(false);
});

it('uses neutral unknown traits, bounded own interest and separate satiation', () => {
  expect(scoreBookActivity(gates, .5, 1, 0)).toBeCloseTo(1.2);
  for (const trait of [undefined, NaN, Infinity, -.1, 1.1]) expect(scoreBookActivity(gates, trait, 1, 0)).toBeCloseTo(1.2);
  expect(scoreBookActivity(gates, 0, 1, 0)).toBeCloseTo(.6);
  expect(scoreBookActivity(gates, 1, 1, 0)).toBeCloseTo(1.8);
  expect(scoreBookActivity(gates, .5, 99, .5)).toBeCloseTo(1.2 * 1.2 * .625);
  expect(scoreBookActivity(gates, .5, -99, 0)).toBeCloseTo(1.2 * .8);
  expect(scoreBookActivity(gates, .5, NaN, 0)).toBeCloseTo(1.2);
  expect(bookSatiationMultiplier(undefined)).toBe(1);
  expect(bookSatiationMultiplier(NaN)).toBe(1);
  expect(bookSatiationMultiplier(-1)).toBe(1);
  expect(bookSatiationMultiplier(2)).toBe(.25);
});

it('keeps actual phase durations and rejects exact deadline or a stalled late completion', () => {
  expect(BOOK_SESSION_TUNING.settleMs + BOOK_SESSION_TUNING.withBookMs + BOOK_SESSION_TUNING.finishMs).toBe(14_000);
  expect(BOOK_SESSION_TUNING.cooldownMs).toBe(30_000);
  expect(isBookDeadlineReached(100, 16_099)).toBe(false);
  expect(isBookDeadlineReached(100, 16_100)).toBe(true);
  expect(isBookDeadlineReached(100, 600_100)).toBe(true);
  expect(isBookDeadlineReached(100, 99)).toBe(true);
  expect(isBookDeadlineReached(NaN, 100)).toBe(true);
});
