import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { projectedGazeGeometry } from '../render-engine/sprite-projection';
import type { RenderPresentationState, SpritePoint } from '../render-engine/types';

/** Layout is measured on invalidation, not on every pupil animation frame. */
export function useGazeGeometry(rootRef: RefObject<HTMLDivElement | null>,
  state: RenderPresentationState | undefined, anchor: SpritePoint | undefined,
  renderedSize: { readonly width: number; readonly height: number }) {
  const boundsRef = useRef<DOMRect | undefined>(undefined);
  useEffect(() => {
    const invalidate = () => { boundsRef.current = undefined; };
    invalidate();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(invalidate);
    if (rootRef.current !== null) observer?.observe(rootRef.current);
    window.addEventListener('resize', invalidate);
    window.addEventListener('scroll', invalidate, true);
    return () => { observer?.disconnect(); window.removeEventListener('resize', invalidate);
      window.removeEventListener('scroll', invalidate, true); invalidate(); };
  }, [rootRef, renderedSize.width, renderedSize.height]);
  return useCallback(() => {
    const root = rootRef.current;
    if (root === null || state === undefined || anchor === undefined) return undefined;
    const bounds = boundsRef.current ??= root.getBoundingClientRect();
    return projectedGazeGeometry({ viewport: state.viewport, rootPivot: state.rootPivot,
      renderedSize: bounds, transform: state.transform }, anchor,
      { x: window.screenX + bounds.left, y: window.screenY + bounds.top });
  }, [rootRef, state, anchor]);
}
