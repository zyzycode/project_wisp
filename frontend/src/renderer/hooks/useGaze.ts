import { useEffect, useRef } from 'react';
import {
  GazeEngine,
  type GazeGeometry,
  type GazeState,
  type GazePresentationDirection,
  type CursorSample,
} from '../../domain/behavior/gaze-engine';
import {
  CursorObservationRefresh,
  registerCursorObservationListeners,
  type CursorScreenPosition,
} from '../body-ui-runtime';

const NEUTRAL_GAZE_DIRECTION: GazePresentationDirection = 'neutral';

export interface UseGazeOptions {
  readonly enabled: boolean;
  readonly globalCursor?: CursorSample | null;
  readonly observationEnabled?: boolean;
  /** Returns the current source-canvas geometry, including its screen position. */
  readonly getGeometry: () => GazeGeometry | undefined;
  /** Selects a discrete frame from the face_gaze overlay. */
  readonly onGazeDirection: (direction: GazePresentationDirection) => void;
  readonly onGazeOffset?: (offset: { readonly x: number; readonly y: number }) => void;
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
  globalCursor,
  observationEnabled = true,
  getGeometry,
  onGazeDirection,
  onGazeOffset,
  onCursorObserved,
  observationLifecycleKey,
}: UseGazeOptions): void {
  const cursorRef = useRef<CursorSample | undefined>(undefined);
  const globalCursorRef = useRef(globalCursor);
  globalCursorRef.current = globalCursor;
  const observationEnabledRef = useRef(observationEnabled);
  observationEnabledRef.current = observationEnabled;
  const gazeStateRef = useRef<GazeState>({
    mode: 'neutral',
    direction: NEUTRAL_GAZE_DIRECTION,
    updatedAtMs: 0,
  });
  const gazeEngineRef = useRef(new GazeEngine());
  const getGeometryRef = useRef(getGeometry);
  const onGazeDirectionRef = useRef(onGazeDirection);
  const onGazeOffsetRef = useRef(onGazeOffset);
  onGazeOffsetRef.current = onGazeOffset;
  const onCursorObservedRef = useRef(onCursorObserved);
  getGeometryRef.current = getGeometry;
  onGazeDirectionRef.current = onGazeDirection;
  onCursorObservedRef.current = onCursorObserved;

  useEffect(() => {
    // A replacement Brain stream must not inherit the previous stream's gaze.
    gazeStateRef.current = {
      mode: 'neutral', direction: NEUTRAL_GAZE_DIRECTION, updatedAtMs: 0,
    };
    if (!enabled) {
      cursorRef.current = undefined;
      onGazeDirectionRef.current(NEUTRAL_GAZE_DIRECTION);
      onGazeOffsetRef.current?.({ x: 0, y: 0 });
      return undefined;
    }

    const observationRefresh = new CursorObservationRefresh((position) => {
      // A bounded browser presence refresh confirms a stationary local cursor.
      cursorRef.current = { globalPosition: position, capturedAtMs: performance.now() };
      if (observationEnabledRef.current && globalCursorRef.current == null) onCursorObservedRef.current?.(position);
    }, {
      now: () => performance.now(),
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
    });
    const handleMouseMove = (event: { readonly screenX: number; readonly screenY: number }): void => {
      const screenPosition = { x: event.screenX, y: event.screenY };
      cursorRef.current = {
        globalPosition: screenPosition,
        capturedAtMs: performance.now(),
      };
      observationRefresh.observe(screenPosition);
    };
    const clearCursor = (): void => {
      cursorRef.current = undefined;
      observationRefresh.clear();
    };

    let gazeFrameId = 0;
    let previousNow: number | undefined;
    const tick = (now: number): void => {
      const geometry = getGeometryRef.current();
      if (geometry !== undefined) {
        // Global source takes precedence; a stopped stream expires in the engine.
        const cursor = globalCursorRef.current ?? cursorRef.current;
        const nextState = gazeEngineRef.current.update(gazeStateRef.current, {
          nowMs: now,
          deltaSec: previousNow === undefined ? 0 : Math.max(0, (now - previousNow) / 1000),
          target: cursor === undefined
            ? { type: 'neutral' }
            : {
              type: 'cursor',
              sample: cursor,
            },
          geometry,
        });
        gazeStateRef.current = nextState;
        onGazeDirectionRef.current(nextState.direction);
        onGazeOffsetRef.current?.(nextState.offset ?? { x: 0, y: 0 });
      }
      previousNow = now;
      gazeFrameId = window.requestAnimationFrame(tick);
    };

    const removeObservationListeners = registerCursorObservationListeners(
      {
        addEventListener: (type, listener) => window.addEventListener(type, listener as EventListener),
        removeEventListener: (type, listener) => window.removeEventListener(type, listener as EventListener),
      },
      {
        get hidden() { return document.hidden; },
        addEventListener: (type, listener) => document.addEventListener(type, listener as EventListener),
        removeEventListener: (type, listener) => document.removeEventListener(type, listener as EventListener),
      },
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
