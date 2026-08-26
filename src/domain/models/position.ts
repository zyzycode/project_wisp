/**
 * Domain Model: Pet Position & Geometry Calculations
 * Pure TypeScript, zero external/OS dependencies.
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface Size2D {
  width: number;
  height: number;
}

export interface RectBounds extends Point2D, Size2D {}

/**
 * Clamps a 2D position so that the pet bounding box stays strictly inside the screen work area.
 */
export function clampPositionToBounds(
  targetPos: Point2D,
  petSize: Size2D,
  screenBounds: RectBounds
): Point2D {
  const minX = screenBounds.x;
  const maxX = Math.max(minX, screenBounds.x + screenBounds.width - petSize.width);

  const minY = screenBounds.y;
  const maxY = Math.max(minY, screenBounds.y + screenBounds.height - petSize.height);

  return {
    x: Math.round(Math.min(Math.max(targetPos.x, minX), maxX)),
    y: Math.round(Math.min(Math.max(targetPos.y, minY), maxY)),
  };
}

/**
 * Calculates velocity and tilt angle during dragging for realistic inertia.
 */
export function calculateDragInertia(
  currentPos: Point2D,
  prevPos: Point2D,
  deltaTimeMs: number
): { velocityX: number; velocityY: number; tiltDeg: number } {
  if (deltaTimeMs <= 0) {
    return { velocityX: 0, velocityY: 0, tiltDeg: 0 };
  }

  const dx = currentPos.x - prevPos.x;
  const dy = currentPos.y - prevPos.y;

  const velocityX = (dx / deltaTimeMs) * 1000;
  const velocityY = (dy / deltaTimeMs) * 1000;

  // Max tilt ±25 degrees based on horizontal drag speed
  const maxTilt = 25;
  const tiltDeg = Math.max(-maxTilt, Math.min(maxTilt, (velocityX / 20)));

  return { velocityX, velocityY, tiltDeg };
}
