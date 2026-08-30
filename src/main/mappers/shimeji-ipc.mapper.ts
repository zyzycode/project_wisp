import type {
  EnvironmentSnapshotDTO,
  PetAnimationStateDTO,
  PetPresentationStateDTO,
} from '../../shared/ipc-contracts';
import type { MotionState } from '../../domain/behavior/motion-engine';
import type { EnvironmentSnapshot } from '../../domain/behavior/surface-kinematics';

export interface PetPresentationState {
  readonly revision: number;
  readonly motion: MotionState;
  readonly animationState: PetAnimationStateDTO;
}

export function toEnvironmentSnapshotDTO(snapshot: EnvironmentSnapshot): EnvironmentSnapshotDTO {
  return {
    capturedAtMs: snapshot.capturedAtMs,
    screenBounds: { ...snapshot.screenBounds },
    ...(snapshot.currentSurface === undefined
      ? {}
      : {
          currentSurface: {
            id: snapshot.currentSurface.id,
            kind: snapshot.currentSurface.kind,
            bounds: { ...snapshot.currentSurface.bounds },
            ...(snapshot.currentSurface.supportY === undefined
              ? {}
              : { supportY: snapshot.currentSurface.supportY }),
            isValidSupport: snapshot.currentSurface.isValidSupport,
          },
        }),
  };
}

export function toEnvironmentSnapshot(snapshot: EnvironmentSnapshotDTO): EnvironmentSnapshot {
  return {
    capturedAtMs: snapshot.capturedAtMs,
    screenBounds: { ...snapshot.screenBounds },
    ...(snapshot.currentSurface === undefined
      ? {}
      : {
          currentSurface: {
            id: snapshot.currentSurface.id,
            kind: snapshot.currentSurface.kind,
            bounds: { ...snapshot.currentSurface.bounds },
            ...(snapshot.currentSurface.supportY === undefined
              ? {}
              : { supportY: snapshot.currentSurface.supportY }),
            isValidSupport: snapshot.currentSurface.isValidSupport,
          },
        }),
  };
}

export function toPetPresentationStateDTO(state: PetPresentationState): PetPresentationStateDTO {
  return {
    revision: state.revision,
    motionPhase: state.motion.phase,
    rootScreenPosition: { ...state.motion.position },
    velocityPxPerSec: { ...state.motion.velocityPxPerSec },
    positionAuthority: state.motion.phase === 'grounded' ? 'voluntary' : 'forced',
    animationState: state.animationState,
  };
}
