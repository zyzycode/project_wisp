import { screen } from 'electron';
import { performance } from 'node:perf_hooks';
import type { EnvironmentSnapshot } from '../../domain/behavior/surface-kinematics';

export type EnvironmentSnapshotListener = (snapshot: EnvironmentSnapshot) => void;

/**
 * Main-process adapter for the primary display's usable desktop geometry.
 * Electron owns display discovery; callers only receive serializable domain DTOs.
 */
export class PlatformEnvironmentAdapter {
  private lastCapturedAtMs = 0;

  public getSnapshot(): EnvironmentSnapshot {
    const workArea = screen.getPrimaryDisplay().workArea;
    const capturedAtMs = Math.max(performance.now(), this.lastCapturedAtMs);
    this.lastCapturedAtMs = capturedAtMs;

    const screenBounds = {
      id: 'primary_screen',
      x: workArea.x,
      y: workArea.y,
      width: workArea.width,
      height: workArea.height,
    };

    return {
      capturedAtMs,
      screenBounds,
      currentSurface: {
        id: 'primary_screen_floor',
        kind: 'screen_floor',
        bounds: {
          x: workArea.x,
          y: workArea.y,
          width: workArea.width,
          height: workArea.height,
        },
        supportY: workArea.y + workArea.height,
        isValidSupport: true,
      },
    };
  }

  public onEnvironmentChanged(listener: EnvironmentSnapshotListener): () => void {
    const handler = (): void => listener(this.getSnapshot());
    screen.on('display-metrics-changed', handler);
    return (): void => {
      screen.removeListener('display-metrics-changed', handler);
    };
  }
}
