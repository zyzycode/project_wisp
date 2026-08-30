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
    direction: 'down',
    updatedAtMs: 0,
    ...overrides,
  };
}

function proximityState(overrides: Partial<CursorProximityState> = {}): CursorProximityState {
  return {
    withinSwatRange: false,
    dwellWithinSwatRangeMs: 0,
    updatedAtMs: 0,
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
  it('uses the down frame as neutral inside the dead zone', () => {
    const result = new GazeEngine().update(gazeState(), {
      nowMs: 20,
      deltaSec: 0.02,
      target: { type: 'world_point', globalPosition: { x: 111, y: 100 } },
      geometry,
    });

    expect(result.mode).toBe('neutral');
    expect(result.direction).toBe('down');
  });

  it('uses scale and flipX to choose the local horizontal direction', () => {
    const result = new GazeEngine().update(gazeState(), {
      nowMs: 80,
      deltaSec: 0.08,
      target: { type: 'world_point', globalPosition: { x: 380, y: 100 } },
      geometry: { ...geometry, flipX: true },
    });
    expect(result.mode).toBe('tracking');
    expect(result.direction).toBe('left');
  });

  it('uses vertical frames and returns to down for distant or stale cursors', () => {
    const engine = new GazeEngine();
    const previous = gazeState({
      mode: 'tracking',
      direction: 'right',
      updatedAtMs: 0,
    });
    const distant = engine.update(previous, {
      nowMs: 80,
      deltaSec: 0.08,
      target: { type: 'world_point', globalPosition: { x: 500, y: 100 } },
      geometry,
    });

    expect(distant.mode).toBe('neutral');
    expect(distant.direction).toBe('down');

    const stale = engine.update(distant, {
      nowMs: 400,
      deltaSec: 0.08,
      target: {
        type: 'cursor',
        sample: { globalPosition: { x: 200, y: 100 }, capturedAtMs: 100 },
      },
      geometry,
    });
    expect(stale.mode).toBe('neutral');
    expect(stale.direction).toBe('down');
  });

  it('tracks a fresh cursor at any distance and keeps that direction while it is current', () => {
    const engine = new GazeEngine();
    const farCursor = {
      type: 'cursor' as const,
      sample: { globalPosition: { x: 10_000, y: 100 }, capturedAtMs: 20 },
    };
    const initial = engine.update(gazeState(), {
      nowMs: 20,
      deltaSec: 0.02,
      target: farCursor,
      geometry,
    });
    const held = engine.update(initial, {
      nowMs: 500,
      deltaSec: 0.02,
      target: { ...farCursor, sample: { ...farCursor.sample, capturedAtMs: 500 } },
      geometry,
    });

    expect(initial.direction).toBe('right');
    expect(held.direction).toBe('right');
  });

  it.each([
    [{ x: 100, y: -100 }, 'up'],
    [{ x: -100, y: 100 }, 'left'],
    [{ x: 300, y: 100 }, 'right'],
    [{ x: 100, y: 300 }, 'down'],
  ] as const)('maps the dominant cursor axis to face_gaze %s', (globalPosition, direction) => {
    const result = new GazeEngine().update(gazeState(), {
      nowMs: 20,
      deltaSec: 0.02,
      target: { type: 'world_point', globalPosition },
      geometry,
    });
    expect(result.direction).toBe(direction);
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
  it('accumulates dwell as a pure signal; Activity cooldown owns swat eligibility', () => {
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
    expect(update.signal?.dwellWithinSwatRangeMs).toBe(449);

    update = engine.update(update.state, {
      nowMs: 450,
      rootGlobalPosition: { x: 100, y: 100 },
      cursor: cursorAtRoot(450),
      compatible: true,
    });
    expect(update.signal?.dwellWithinSwatRangeMs).toBe(450);
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

  it('uses the configured distance and dwell values', () => {
    const engine = new CursorProximityEngine();
    const constraints = {
      ...DEFAULT_CURSOR_REACTION_CONSTRAINTS,
      swatRadiusWorldPx: 10,
      swatDwellMs: 20,
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

    expect(ready.signal?.dwellWithinSwatRangeMs).toBe(20);
  });
});
