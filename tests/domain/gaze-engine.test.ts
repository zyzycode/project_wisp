import { describe, expect, it } from 'vitest';
import {
  CursorProximityEngine,
  DEFAULT_CURSOR_REACTION_CONSTRAINTS,
  GazeEngine,
  type CursorProximityState,
  type GazeState,
} from '../../src/domain/behavior';

function gazeState(overrides: Partial<GazeState> = {}): GazeState {
  return {
    mode: 'neutral',
    pupilOffset: { xSourcePx: 0, ySourcePx: 0 },
    updatedAtMs: 0,
    ...overrides,
  };
}

function proximityState(overrides: Partial<CursorProximityState> = {}): CursorProximityState {
  return {
    withinSwatRange: false,
    dwellWithinSwatRangeMs: 0,
    updatedAtMs: 0,
    swatCooldownUntilMs: 0,
    ...overrides,
  };
}

const geometry = {
  rootGlobalPosition: { x: 100, y: 100 },
  gazeOriginSourcePx: { x: 0, y: 0 },
  scale: 1,
  flipX: false,
};

describe('Domain: GazeEngine', () => {
  it('keeps neutral pupils inside the dead zone', () => {
    const result = new GazeEngine().update(gazeState(), {
      nowMs: 20,
      deltaSec: 0.02,
      target: { type: 'world_point', globalPosition: { x: 111, y: 100 } },
      geometry,
    });

    expect(result.mode).toBe('neutral');
    expect(result.pupilOffset).toEqual({ xSourcePx: 0, ySourcePx: 0 });
  });

  it('uses scale, flipX, and exponential smoothing without a discontinuity', () => {
    const result = new GazeEngine().update(gazeState(), {
      nowMs: 80,
      deltaSec: 0.08,
      target: { type: 'world_point', globalPosition: { x: 380, y: 100 } },
      geometry: { ...geometry, flipX: true },
    });
    const alpha = 1 - Math.exp(-1);

    expect(result.mode).toBe('tracking');
    expect(result.pupilOffset.xSourcePx).toBeCloseTo(-14 * alpha, 8);
    expect(result.pupilOffset.ySourcePx).toBeCloseTo(0, 8);
  });

  it('smoothly returns to neutral for a distant or stale cursor', () => {
    const engine = new GazeEngine();
    const previous = gazeState({
      mode: 'tracking',
      pupilOffset: { xSourcePx: 10, ySourcePx: 5 },
      updatedAtMs: 0,
    });
    const distant = engine.update(previous, {
      nowMs: 80,
      deltaSec: 0.08,
      target: { type: 'world_point', globalPosition: { x: 500, y: 100 } },
      geometry,
    });

    expect(distant.mode).toBe('returning_to_neutral');
    expect(distant.pupilOffset.xSourcePx).toBeCloseTo(10 * Math.exp(-1), 8);
    expect(distant.pupilOffset.ySourcePx).toBeCloseTo(5 * Math.exp(-1), 8);

    const stale = engine.update(distant, {
      nowMs: 400,
      deltaSec: 0.08,
      target: {
        type: 'cursor',
        sample: { globalPosition: { x: 200, y: 100 }, capturedAtMs: 100 },
      },
      geometry,
    });
    expect(stale.mode).toBe('returning_to_neutral');
    expect(stale.pupilOffset.xSourcePx).toBeLessThan(distant.pupilOffset.xSourcePx);
  });

  it('validates monotonic timing and positive rendering scale', () => {
    const engine = new GazeEngine();
    expect(() =>
      engine.update(gazeState({ updatedAtMs: 10 }), {
        nowMs: 9,
        deltaSec: 0.01,
        target: { type: 'neutral' },
        geometry,
      })
    ).toThrow(RangeError);
    expect(() =>
      engine.update(gazeState(), {
        nowMs: 1,
        deltaSec: 0.01,
        target: { type: 'neutral' },
        geometry: { ...geometry, scale: 0 },
      })
    ).toThrow(RangeError);
  });
});

describe('Domain: CursorProximityEngine', () => {
  it('accumulates dwell, exposes readiness, and honors an explicit cooldown', () => {
    const engine = new CursorProximityEngine();
    const cursorAtRoot = (capturedAtMs: number) => ({
      globalPosition: { x: 100, y: 100 },
      capturedAtMs,
    });
    let update = engine.update(proximityState(), {
      nowMs: 0,
      rootGlobalPosition: { x: 100, y: 100 },
      cursor: cursorAtRoot(0),
      compatible: true,
    });
    expect(update.state.dwellWithinSwatRangeMs).toBe(0);

    update = engine.update(update.state, {
      nowMs: 449,
      rootGlobalPosition: { x: 100, y: 100 },
      cursor: cursorAtRoot(449),
      compatible: true,
    });
    expect(update.state.dwellWithinSwatRangeMs).toBe(449);
    expect(update.signal?.isSwatReady).toBe(false);

    update = engine.update(update.state, {
      nowMs: 450,
      rootGlobalPosition: { x: 100, y: 100 },
      cursor: cursorAtRoot(450),
      compatible: true,
    });
    expect(update.signal?.isSwatReady).toBe(true);

    const coolingDown = engine.beginSwatCooldown(update.state, 450);
    const suppressed = engine.update(coolingDown, {
      nowMs: 900,
      rootGlobalPosition: { x: 100, y: 100 },
      cursor: cursorAtRoot(900),
      compatible: true,
    });
    expect(suppressed.signal?.isSwatReady).toBe(false);
    expect(coolingDown.swatCooldownUntilMs).toBe(450 + DEFAULT_CURSOR_REACTION_CONSTRAINTS.swatCooldownMs);
  });

  it('resets dwell for an out-of-range, incompatible, missing, or stale cursor', () => {
    const engine = new CursorProximityEngine();
    const primed = proximityState({ withinSwatRange: true, dwellWithinSwatRangeMs: 700, updatedAtMs: 700 });
    const common = { rootGlobalPosition: { x: 0, y: 0 }, compatible: true };

    const outOfRange = engine.update(primed, {
      ...common,
      nowMs: 800,
      cursor: { globalPosition: { x: 65, y: 0 }, capturedAtMs: 800 },
    });
    expect(outOfRange.state.dwellWithinSwatRangeMs).toBe(0);

    const incompatible = engine.update(primed, {
      ...common,
      compatible: false,
      nowMs: 800,
      cursor: { globalPosition: { x: 0, y: 0 }, capturedAtMs: 800 },
    });
    expect(incompatible.state.dwellWithinSwatRangeMs).toBe(0);

    const missing = engine.update(primed, { ...common, nowMs: 800 });
    expect(missing.state.dwellWithinSwatRangeMs).toBe(0);

    const stale = engine.update(primed, {
      ...common,
      nowMs: 1000,
      cursor: { globalPosition: { x: 0, y: 0 }, capturedAtMs: 700 },
    });
    expect(stale.state.dwellWithinSwatRangeMs).toBe(0);
  });

  it('uses the configured distance, dwell, and cooldown values', () => {
    const engine = new CursorProximityEngine();
    const constraints = {
      ...DEFAULT_CURSOR_REACTION_CONSTRAINTS,
      swatRadiusWorldPx: 10,
      swatDwellMs: 20,
      swatCooldownMs: 30,
    };
    const state = engine.update(proximityState(), {
      nowMs: 0,
      rootGlobalPosition: { x: 0, y: 0 },
      cursor: { globalPosition: { x: 10, y: 0 }, capturedAtMs: 0 },
      compatible: true,
    }, constraints).state;
    const ready = engine.update(state, {
      nowMs: 20,
      rootGlobalPosition: { x: 0, y: 0 },
      cursor: { globalPosition: { x: 10, y: 0 }, capturedAtMs: 20 },
      compatible: true,
    }, constraints);

    expect(ready.signal?.isSwatReady).toBe(true);
    expect(engine.beginSwatCooldown(ready.state, 20, constraints).swatCooldownUntilMs).toBe(50);
  });
});
