import { expect, it } from 'vitest';
import { initialCursorGameParticipation, observeCursorGameParticipation } from '../../src/domain/behavior/cursor-game-participation';
import type { GameObservation } from '../../src/domain/behavior/cursor-game';
const tuning = { minTargetShiftDip: 20 };
const game = { outcome: null, supportId: 'floor', supportKind: 'screen_floor' } as const;
function observation(capturedAtMs: number, x = 440, rootX = 400): GameObservation {
  const bounds = { id: 'screen', x: 0, y: 0, width: 1000, height: 800 };
  return { root: { x: rootX, y: 790 }, collisionInsets: { left: 10, right: 10, top: 80, bottom: 10 }, dwellMs: 500,
    environment: { capturedAtMs, screenBounds: bounds, currentSurface: { id: 'floor', kind: 'screen_floor', bounds, isValidSupport: true } },
    cursor: { globalPosition: { x, y: 790 }, capturedAtMs } };
}
const first = () => observeCursorGameParticipation(initialCursorGameParticipation(100), 100, game, observation(200), tuning, 200);
it.each([100, 2000])('latches only absolute cursor movement at the inclusive %ims interval', gap => {
  const result = observeCursorGameParticipation(first(), 100, game, observation(200 + gap, 460), tuning, 200 + gap);
  expect(result.engaged).toBe(true);
  expect(result.anchor).toBeNull();
});
it.each([99, 2001])('does not latch outside the movement interval (%ims)', gap => {
  expect(observeCursorGameParticipation(first(), 100, game, observation(200 + gap, 460), tuning, 200 + gap).engaged).toBe(false);
});
it('keeps the anchor through fast/subthreshold samples so tick frequency cannot create or erase displacement', () => {
  let state = first();
  for (const [at, x] of [[225, 445], [250, 450], [275, 455], [299, 459.99]]) {
    state = observeCursorGameParticipation(state, 100, game, observation(at!, x!), tuning, at!);
    expect(state.engaged).toBe(false);
  }
  expect(observeCursorGameParticipation(state, 100, game, observation(300, 460), tuning, 300).engaged).toBe(true);
});
it('does not confuse root movement, stationary cursor or replayed/out-of-order samples with input', () => {
  const anchor = first();
  let state = observeCursorGameParticipation(anchor, 100, game, observation(300, 440, 420), tuning, 300);
  expect(state.engaged).toBe(false);
  for (const at of [300, 250, 200]) state = observeCursorGameParticipation(state, 100, game, observation(at, 470), tuning, 300);
  expect(state.engaged).toBe(false); expect(state.anchor).toEqual(anchor.anchor);
  expect(state.highWater).toBe(300);
});
it.each(['pre-start', 'future', 'stale', 'nonfinite', 'missing', 'support', 'unreachable'] as const)('clears an unfinished anchor on %s without rewarding it', kind => {
  let sample = observation(300, 460), now = 300;
  if (kind === 'pre-start') sample = observation(100, 460);
  if (kind === 'future') sample = observation(301, 460);
  if (kind === 'stale') { sample = observation(300, 460); now = 601; }
  if (kind === 'nonfinite') sample = observation(300, NaN);
  if (kind === 'missing') sample = { ...sample, cursor: null };
  if (kind === 'support') sample = { ...sample, environment: { ...sample.environment, currentSurface: undefined } };
  if (kind === 'unreachable') sample = observation(300, 900);
  const state = observeCursorGameParticipation(first(), 100, game, sample, tuning, now);
  expect(state.anchor).toBeNull(); expect(state.engaged).toBe(false);
});
it('never qualifies after outcome, preserves already observed input across loss, and clears it on clock reversal/new run', () => {
  expect(observeCursorGameParticipation(first(), 100, { ...game, outcome: 'caught' }, observation(300, 460), tuning, 300).engaged).toBe(false);
  const latched = observeCursorGameParticipation(first(), 100, game, observation(300, 460), tuning, 300);
  expect(observeCursorGameParticipation(latched, 100, { ...game, outcome: 'lost_target' }, { ...observation(400), cursor: null }, tuning, 400).engaged).toBe(true);
  const reset = observeCursorGameParticipation(latched, 100, game, observation(250, 460), tuning, 250);
  expect(reset.engaged).toBe(false); expect(reset.anchor).toBeNull();
  expect(initialCursorGameParticipation(500).engaged).toBe(false);
});
