import { expect, it } from 'vitest';
import { createBookExposure, observeBookExposure, recoverBookExposure,
  type BookExposureTerminal } from '../../src/domain/character/book-exposure';

const terminal: BookExposureTerminal = { sequence: 1, activity: 'book', activityRunId: 'book-run', outcome: 'cancelled', executedMs: 30_000 };

it('charges actual elapsed time on any terminal once, capped independently from cursor exposure', () => {
  const initial = createBookExposure();
  const observed = observeBookExposure(initial, terminal, 0);
  expect(observed.satiation).toBe(.5);
  expect(observeBookExposure(observed, terminal, 1000)).toBe(observed);
  expect(observeBookExposure(observed, { ...terminal, sequence: 2, executedMs: 600_000 }, 0).satiation).toBe(1);
  expect(observeBookExposure(initial, { ...terminal, outcome: 'completed', executedMs: 14_000 }, 0).satiation).toBeCloseTo(14_000 / 60_000);
  expect(observeBookExposure(initial, { ...terminal, outcome: 'failed', executedMs: 1000 }, 0).satiation).toBeCloseTo(1 / 60);
  for (const change of [{ activity: 'cursor_game' }, { activity: null }, { activityRunId: null }, { outcome: null }, { outcome: 'running' }]) {
    expect(observeBookExposure(initial, { ...terminal, ...change }, 0).satiation).toBe(0);
  }
});

it('recovers with capped active elapsed time and starts neutrally after reset', () => {
  const observed = observeBookExposure(createBookExposure(), terminal, 10);
  expect(recoverBookExposure(observed, 30_010).satiation).toBeCloseTo(.4);
  expect(recoverBookExposure(observed, 300_010).satiation).toBeCloseTo(.3);
  expect(recoverBookExposure(createBookExposure(), 300_010).satiation).toBe(0);
  expect(createBookExposure()).toEqual({ satiation: 0, highWaterSequence: 0, lastMonotonicMs: null });
  expect(recoverBookExposure(observed, 9)).toBe(observed);
  expect(recoverBookExposure(observed, NaN)).toBe(observed);
  for (const executedMs of [-1, NaN, Infinity, 600_001]) {
    expect(observeBookExposure(observed, { ...terminal, sequence: 2, executedMs }, 20)).toBe(observed);
  }
});
