import { expect, it } from 'vitest';
import { createSpriteProjection, projectedGazeGeometry } from '../../src/renderer/render-engine/sprite-projection';
import { GazeEngine } from '../../src/domain/behavior/gaze-engine';

it.each([false, true])('matches gaze to visible transformed face and frame anchors, flip=%s', flipX => {
  const input = { viewport: { width: 400, height: 200 }, renderedSize: { width: 300, height: 300 },
    rootPivot: { x: 100, y: 180 }, transform: { flipX, scale: 0.8, scaleX: 1.2, scaleY: 0.9, rotationDeg: 37 } };
  const projection = createSpriteProjection(input)!;
  const origin = { x: -1700, y: 230 };
  for (const anchor of [{ x: 90, y: 80 }, { x: 110, y: 65 }]) {
    const geometry = projectedGazeGeometry(input, anchor, origin)!;
    for (const [dx, dy, direction] of [[100, 0, 'right'], [-100, 0, 'left'], [0, 100, 'down'], [0, -100, 'up'], [0, 0, 'neutral']] as const) {
      const rendered = projection.project({ x: anchor.x + dx, y: anchor.y + dy });
      const gaze = new GazeEngine().update({ mode: 'neutral', direction: 'neutral', updatedAtMs: 0 }, {
        nowMs: 1000, deltaSec: 1, geometry,
        target: { type: 'world_point', globalPosition: { x: origin.x + rendered.x, y: origin.y + rendered.y } },
      });
      expect(gaze.direction).toBe(direction);
    }
  }
});

it('ignores non-renderable zero sized geometry', () => {
  expect(createSpriteProjection({ viewport: { width: 512, height: 512 }, renderedSize: { width: 0, height: 0 },
    rootPivot: { x: 256, y: 460 }, transform: { scale: 1, flipX: false } })).toBeUndefined();
});
