import { describe, expect, it } from 'vitest';
import type { EnvironmentSnapshot, MotionState } from '../../src/domain/behavior';
import {
  toEnvironmentSnapshot,
  toEnvironmentSnapshotDTO,
  toPetPresentationStateDTO,
} from '../../src/main/mappers/shimeji-ipc.mapper';

const environment: EnvironmentSnapshot = {
  capturedAtMs: 42,
  screenBounds: { id: 'primary', x: -10, y: 20, width: 1920, height: 1080 },
  currentSurface: {
    id: 'floor', kind: 'screen_floor', bounds: { x: -10, y: 20, width: 1920, height: 1080 },
    supportY: 1100, isValidSupport: true,
  },
};

const motion: MotionState = {
  phase: 'airborne', position: { x: 50, y: 60 }, velocityPxPerSec: { x: 70, y: -80 },
  activeBoundsId: 'primary', airborneElapsedSec: 0.5, peakGroundImpactSeverity: 100,
};

describe('Main: Shimeji IPC mappers', () => {
  it('maps environment snapshots at the shared boundary without losing serializable fields', () => {
    const dto = toEnvironmentSnapshotDTO(environment);

    expect(dto).toEqual(environment);
    expect(toEnvironmentSnapshot(dto)).toEqual(environment);
  });

  it('derives a forced presentation DTO for physics-owned motion', () => {
    expect(
      toPetPresentationStateDTO({
        revision: 3, motion, animationState: 'fall', animationRequestId: 'animation-3',
      })
    ).toEqual({
      revision: 3, motionPhase: 'airborne', rootScreenPosition: { x: 50, y: 60 },
      velocityPxPerSec: { x: 70, y: -80 }, positionAuthority: 'forced', animationState: 'fall',
      animationRequestId: 'animation-3',
    });
  });
});
