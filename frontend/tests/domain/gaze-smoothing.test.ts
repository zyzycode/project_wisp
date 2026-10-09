import { describe, expect, it } from 'vitest';
import { GazeEngine, type GazeState } from '../../src/domain/behavior/gaze-engine';

const geometry = { rootGlobalPosition: { x: 0, y: 0 }, gazeOriginSourcePx: { x: 0, y: 0 }, scale: 1, flipX: false };
const initial: GazeState = { mode: 'neutral', direction: 'neutral', updatedAtMs: 0 };
const engine = new GazeEngine();
const track = (previous: GazeState, x: number, y: number, deltaSec: number) => engine.update(previous, {
  nowMs: previous.updatedAtMs + deltaSec * 1000, deltaSec, geometry,
  target: { type: 'world_point', globalPosition: { x, y } },
});

describe('gaze smoothing and neutral presentation', () => {
  it('distinguishes looking down from neutral', () => {
    expect(track(initial, 0, 150, 0.1).mode).toBe('tracking');
    expect(track(initial, 0, 0, 0.1).direction).toBe('neutral');
  });
  it('does not teleport direction when time has not advanced', () => {
    const right = track(initial, 150, 0, 0.1);
    expect(track(right, -150, 0, 0).direction).toBe('right');
  });
  it('holds direction across small diagonal jitter', () => {
    const right = track(initial, 151, 150, 1);
    expect(track(right, 150, 151, 1).direction).toBe('right');
    expect(track(right, 40, 200, 1).direction).toBe('down');
  });
  it('returns gradually after a sample expires, then reaches neutral', () => {
    const right = track(initial, 200, 0, 1);
    const stale = engine.update(right, { nowMs: 1020, deltaSec: 0.02, geometry,
      target: { type: 'cursor', sample: { globalPosition: { x: 200, y: 0 }, capturedAtMs: 700 } } });
    expect(stale.mode).toBe('returning_to_neutral');
    expect(stale.direction).toBe('right');
    expect(engine.update(stale, { nowMs: 3020, deltaSec: 2, geometry, target: { type: 'neutral' } }).direction).toBe('neutral');
  });
});
