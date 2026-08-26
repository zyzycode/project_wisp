import { describe, it, expect } from 'vitest';
import {
  clampPositionToBounds,
  calculateDragInertia,
  RectBounds,
  Size2D,
} from '../../src/domain/models/position';

describe('Domain: Position Clamping', () => {
  const screenBounds: RectBounds = {
    x: 0,
    y: 28, // Top panel 28px
    width: 1920,
    height: 1052, // 1080 - 28px
  };

  const petSize: Size2D = {
    width: 100,
    height: 100,
  };

  it('keeps position unchanged when strictly inside screen bounds', () => {
    const inside = { x: 500, y: 500 };
    const clamped = clampPositionToBounds(inside, petSize, screenBounds);
    expect(clamped).toEqual({ x: 500, y: 500 });
  });

  it('clamps to left and top edges when moving out of bounds', () => {
    const outOfBoundsLeftTop = { x: -50, y: 10 };
    const clamped = clampPositionToBounds(outOfBoundsLeftTop, petSize, screenBounds);
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(28);
  });

  it('clamps to right and bottom edges considering pet dimensions', () => {
    const outOfBoundsRightBottom = { x: 2500, y: 1200 };
    const clamped = clampPositionToBounds(outOfBoundsRightBottom, petSize, screenBounds);
    // maxX = 0 + 1920 - 100 = 1820
    expect(clamped.x).toBe(1820);
    // maxY = 28 + 1052 - 100 = 980
    expect(clamped.y).toBe(980);
  });

  it('works correctly with multi-monitor offset bounds (e.g. secondary monitor at x=1920)', () => {
    const secondaryScreen: RectBounds = {
      x: 1920,
      y: 0,
      width: 1920,
      height: 1080,
    };

    const targetPos = { x: 1900, y: -50 };
    const clamped = clampPositionToBounds(targetPos, petSize, secondaryScreen);
    expect(clamped.x).toBe(1920);
    expect(clamped.y).toBe(0);
  });
});

describe('Domain: Drag Inertia and Tilt', () => {
  it('calculates zero velocity when deltaTime is 0', () => {
    const result = calculateDragInertia({ x: 100, y: 100 }, { x: 50, y: 50 }, 0);
    expect(result.velocityX).toBe(0);
    expect(result.tiltDeg).toBe(0);
  });

  it('calculates rightward tilt for rightward movement', () => {
    const result = calculateDragInertia({ x: 200, y: 100 }, { x: 100, y: 100 }, 100);
    expect(result.velocityX).toBe(1000);
    expect(result.tiltDeg).toBeGreaterThan(0);
    expect(result.tiltDeg).toBeLessThanOrEqual(25);
  });

  it('clamps maximum tilt angle within -25 to +25 degrees', () => {
    const extremeFastRight = calculateDragInertia({ x: 2000, y: 100 }, { x: 0, y: 100 }, 10);
    expect(extremeFastRight.tiltDeg).toBe(25);

    const extremeFastLeft = calculateDragInertia({ x: 0, y: 100 }, { x: 2000, y: 100 }, 10);
    expect(extremeFastLeft.tiltDeg).toBe(-25);
  });
});
