import { useEffect, useRef } from 'react';
import {
  GazeEngine,
  CursorProximityEngine,
  type CursorProximitySignal,
  type CursorProximityState,
  type GazeGeometry,
  type GazeState,
  type GazeDirection,
} from '../../domain/behavior/gaze-engine';

const NEUTRAL_GAZE_DIRECTION: GazeDirection = 'down';

export interface UseGazeOptions {
  readonly enabled: boolean;
  /** Returns the current source-canvas geometry, including its screen position. */
  readonly getGeometry: () => GazeGeometry | undefined;
  /** Selects a discrete frame from the face_gaze overlay. */
  readonly onGazeDirection: (direction: GazeDirection) => void;
  /** Semantic cursor signal for the behavior/activity orchestration boundary. */
  readonly onCursorSignal?: (signal: CursorProximitySignal | undefined) => void;
}

/**
 * Keeps cursor sampling and gaze animation in the renderer. The domain engine
 * owns all gaze math; this hook only supplies browser time and coordinates.
 */
export function useGaze({ enabled, getGeometry, onGazeDirection, onCursorSignal }: UseGazeOptions): void {
  const cursorRef = useRef<{ x: number; y: number; capturedAtMs: number } | undefined>(undefined);
  const gazeStateRef = useRef<GazeState>({
    mode: 'neutral',
    direction: NEUTRAL_GAZE_DIRECTION,
    updatedAtMs: 0,
  });
  const gazeEngineRef = useRef(new GazeEngine());
  const proximityEngineRef = useRef(new CursorProximityEngine());
  const proximityStateRef = useRef<CursorProximityState>({
    withinSwatRange: false,
    dwellWithinSwatRangeMs: 0,
    updatedAtMs: 0,
  });

  useEffect(() => {
    if (!enabled) {
      cursorRef.current = undefined;
      gazeStateRef.current = {
        mode: 'neutral',
        direction: NEUTRAL_GAZE_DIRECTION,
        updatedAtMs: 0,
      };
      proximityStateRef.current = {
        withinSwatRange: false,
        dwellWithinSwatRangeMs: 0,
        updatedAtMs: 0,
      };
      onGazeDirection(NEUTRAL_GAZE_DIRECTION);
      onCursorSignal?.(undefined);
      return undefined;
    }

    let cursorFrameId: number | undefined;
    let queuedCursor: MouseEvent | undefined;
    const handleMouseMove = (event: MouseEvent): void => {
      queuedCursor = event;
      if (cursorFrameId !== undefined) return;
      cursorFrameId = window.requestAnimationFrame((now) => {
        cursorFrameId = undefined;
        if (queuedCursor === undefined) return;
        cursorRef.current = {
          x: queuedCursor.clientX,
          y: queuedCursor.clientY,
          capturedAtMs: now,
        };
        queuedCursor = undefined;
      });
    };

    let gazeFrameId = 0;
    let previousNow: number | undefined;
    const tick = (now: number): void => {
      const geometry = getGeometry();
      if (geometry !== undefined) {
        const cursor = cursorRef.current;
        const nextState = gazeEngineRef.current.update(gazeStateRef.current, {
          nowMs: now,
          deltaSec: previousNow === undefined ? 0 : Math.max(0, (now - previousNow) / 1000),
          target: cursor === undefined
            ? { type: 'neutral' }
            : {
              type: 'cursor',
              sample: {
                globalPosition: { x: cursor.x, y: cursor.y },
                // The last observed cursor position remains the current
                // target until another mousemove replaces it. This avoids a
                // visible snap back after the stale-sample timeout.
                capturedAtMs: now,
              },
            },
          geometry,
        });
        gazeStateRef.current = nextState;
        onGazeDirection(nextState.direction);
        const proximity = proximityEngineRef.current.update(proximityStateRef.current, {
          nowMs: now,
          rootGlobalPosition: geometry.rootGlobalPosition,
          cursor: cursor === undefined
            ? undefined
            : { globalPosition: { x: cursor.x, y: cursor.y }, capturedAtMs: cursor.capturedAtMs },
          compatible: true,
        });
        proximityStateRef.current = proximity.state;
        onCursorSignal?.(proximity.signal);
      }
      previousNow = now;
      gazeFrameId = window.requestAnimationFrame(tick);
    };

    window.addEventListener('mousemove', handleMouseMove);
    gazeFrameId = window.requestAnimationFrame(tick);
    return (): void => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.cancelAnimationFrame(gazeFrameId);
      if (cursorFrameId !== undefined) window.cancelAnimationFrame(cursorFrameId);
    };
  }, [enabled, getGeometry, onCursorSignal, onGazeDirection]);
}
