import { useEffect, useRef } from 'react';
import {
  GazeEngine,
  type GazeGeometry,
  type GazeState,
  type PupilOffset,
} from '../../domain/behavior/gaze-engine';

const NEUTRAL_PUPIL_OFFSET: PupilOffset = { xSourcePx: 0, ySourcePx: 0 };

export interface UseGazeOptions {
  readonly enabled: boolean;
  /** Returns the current source-canvas geometry, including its screen position. */
  readonly getGeometry: () => GazeGeometry | undefined;
  /** Applies a source-pixel offset without requiring a React tree re-render. */
  readonly onPupilOffset: (offset: PupilOffset) => void;
}

/**
 * Keeps cursor sampling and gaze animation in the renderer. The domain engine
 * owns all gaze math; this hook only supplies browser time and coordinates.
 */
export function useGaze({ enabled, getGeometry, onPupilOffset }: UseGazeOptions): void {
  const cursorRef = useRef<{ x: number; y: number; capturedAtMs: number } | undefined>(undefined);
  const gazeStateRef = useRef<GazeState>({
    mode: 'neutral',
    pupilOffset: NEUTRAL_PUPIL_OFFSET,
    updatedAtMs: 0,
  });
  const gazeEngineRef = useRef(new GazeEngine());

  useEffect(() => {
    if (!enabled) {
      cursorRef.current = undefined;
      gazeStateRef.current = {
        mode: 'neutral',
        pupilOffset: NEUTRAL_PUPIL_OFFSET,
        updatedAtMs: 0,
      };
      onPupilOffset(NEUTRAL_PUPIL_OFFSET);
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
          x: queuedCursor.screenX,
          y: queuedCursor.screenY,
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
                capturedAtMs: cursor.capturedAtMs,
              },
            },
          geometry,
        });
        gazeStateRef.current = nextState;
        onPupilOffset(nextState.pupilOffset);
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
  }, [enabled, getGeometry, onPupilOffset]);
}
