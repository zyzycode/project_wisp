import type { GazeGeometry } from '../../domain/behavior/gaze-engine';
import type { RenderPresentationState, SpritePoint } from './types';

type Transform = RenderPresentationState['transform'];
export interface SpriteProjectionInput {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly rootPivot: SpritePoint;
  readonly renderedSize: { readonly width: number; readonly height: number };
  readonly transform: Transform;
}

/** Same order as the SVG group: translate(pivot), rotate, scale, translate(-pivot). */
export function spriteTransform(pivot: SpritePoint, transform: Transform): string {
  return [`translate(${pivot.x} ${pivot.y})`,
    ...((transform.rotationDeg ?? 0) === 0 ? [] : [`rotate(${transform.rotationDeg})`]),
    `scale(${(transform.flipX ? -1 : 1) * transform.scale * (transform.scaleX ?? 1)} ${transform.scale * (transform.scaleY ?? 1)})`,
    `translate(${-pivot.x} ${-pivot.y})`].join(' ');
}

export function createSpriteProjection(input: SpriteProjectionInput) {
  const { viewport, renderedSize, rootPivot: pivot, transform } = input;
  const meet = Math.min(renderedSize.width / viewport.width, renderedSize.height / viewport.height);
  const sx = meet * transform.scale * (transform.scaleX ?? 1) * (transform.flipX ? -1 : 1);
  const sy = meet * transform.scale * (transform.scaleY ?? 1);
  const angle = (transform.rotationDeg ?? 0) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const a = cos * sx, b = sin * sx, c = -sin * sy, d = cos * sy;
  const origin = { x: (renderedSize.width - viewport.width * meet) / 2 + pivot.x * meet,
    y: (renderedSize.height - viewport.height * meet) / 2 + pivot.y * meet };
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || determinant === 0) return undefined;
  return { meet, origin,
    sourceFromWorld: { xx: d / determinant, xy: -c / determinant, yx: -b / determinant, yy: a / determinant },
    project(point: SpritePoint): SpritePoint {
      const x = point.x - pivot.x, y = point.y - pivot.y;
      return { x: origin.x + a * x + c * y, y: origin.y + b * x + d * y };
    },
  };
}

export function projectedGazeGeometry(input: SpriteProjectionInput, anchor: SpritePoint,
  globalTopLeft: SpritePoint): GazeGeometry | undefined {
  const projection = createSpriteProjection(input);
  if (projection === undefined) return undefined;
  return {
    rootGlobalPosition: { x: globalTopLeft.x + projection.origin.x, y: globalTopLeft.y + projection.origin.y },
    gazeOriginSourcePx: { x: anchor.x - input.rootPivot.x, y: anchor.y - input.rootPivot.y },
    scale: projection.meet,
    flipX: input.transform.flipX,
    sourceFromWorld: projection.sourceFromWorld,
  };
}
