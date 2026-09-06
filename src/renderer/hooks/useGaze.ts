import { useEffect, useRef } from 'react';
import {
  GazeEngine,
  type GazeGeometry,
  type GazeState,
  type GazeDirection,
} from '../../domain/behavior/gaze-engine';
import {
  CursorObservationRefresh,
  registerCursorObservationListeners,
  type CursorScreenPosition,
  type ListenerTarget,
  type VisibilityListenerTarget,
} from '../body-ui-runtime';

const NEUTRAL_GAZE_DIRECTION: GazeDirection = 'down';

export interface UseGazeOptions {
  readonly enabled: boolean;
  /** Returns the current source-canvas geometry, including its screen position. */
  readonly getGeometry: () => GazeGeometry | undefined;
  /** Selects a discrete frame from the face_gaze overlay. */
  readonly onGazeDirection: (direction: GazeDirection) => void;
  /** Raw bounded cursor observation for the typed Body → Brain boundary. */
  readonly onCursorObserved?: (position: CursorScreenPosition) => void;
  /** Restarts capture when the owning Brain stream changes. */
  readonly observationLifecycleKey?: string;
}

/**
 * Keeps cursor sampling and gaze animation in the renderer. The domain engine
 * owns all gaze math; this hook only supplies browser time and coordinates.
 */
export function useGaze({
  enabled,
  getGeometry,
  onGazeDirection,
  onCursorObserved,
  observationLifecycleKey,
}: UseGazeOptions): void {
  const cursorRef = useRef<{
    readonly globalPosition: { readonly x: number; readonly y: number };
  } | undefined>(undefined);
  const gazeStateRef = useRef<GazeState>({
    mode: 'neutral',
    direction: NEUTRAL_GAZE_DIRECTION,
    updatedAtMs: 0,
  });
  const gazeEngineRef = useRef(new GazeEngine());
  const getGeometryRef = useRef(getGeometry);
  const onGazeDirectionRef = useRef(onGazeDirection);
  const onCursorObservedRef = useRef(onCursorObserved);
  getGeometryRef.current = getGeometry;
  onGazeDirectionRef.current = onGazeDirection;
  onCursorObservedRef.current = onCursorObserved;

  useEffect(() => {
    if (!enabled) {
      cursorRef.current = undefined;
      gazeStateRef.current = {
        mode: 'neutral',
        direction: NEUTRAL_GAZE_DIRECTION,
        updatedAtMs: 0,
      };
      onGazeDirectionRef.current(NEUTRAL_GAZE_DIRECTION);
      return undefined;
    }

    const observationRefresh = new CursorObservationRefresh((position) => {
      onCursorObservedRef.current?.(position);
    }, {
      now: () => performance.now(),
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
    });
    const handleMouseMove = (event: { readonly screenX: number; readonly screenY: number }): void => {
      const screenPosition = { x: event.screenX, y: event.screenY };
      cursorRef.current = {
        globalPosition: screenPosition,
      };
      observationRefresh.observe(screenPosition);
    };
    const clearCursor = (): void => {
      cursorRef.current = undefined;
      observationRefresh.clear();
      onGazeDirectionRef.current(NEUTRAL_GAZE_DIRECTION);
    };

    let gazeFrameId = 0;
    let previousNow: number | undefined;
    const tick = (now: number): void => {
      const geometry = getGeometryRef.current();
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
                globalPosition: cursor.globalPosition,
                capturedAtMs: now,
              },
            },
          geometry,
        });
        gazeStateRef.current = nextState;
        onGazeDirectionRef.current(nextState.direction);
      }
      previousNow = now;
      gazeFrameId = window.requestAnimationFrame(tick);
    };

    const removeObservationListeners = registerCursorObservationListeners(
      window as unknown as ListenerTarget,
      document as unknown as VisibilityListenerTarget,
      { move: handleMouseMove, unavailable: clearCursor }
    );
    gazeFrameId = window.requestAnimationFrame(tick);
    return (): void => {
      removeObservationListeners();
      window.cancelAnimationFrame(gazeFrameId);
      observationRefresh.destroy();
      cursorRef.current = undefined;
    };
  }, [enabled, observationLifecycleKey]);
}
