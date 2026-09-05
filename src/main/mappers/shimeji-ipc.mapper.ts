import type {
  BrainStateDTO,
  BrainVisualIntentDTO,
  EnvironmentSnapshotDTO,
} from '../../shared/ipc-contracts';
import type { MotionState } from '../../domain/behavior/motion-engine';
import type { EnvironmentSnapshot } from '../../domain/behavior/surface-kinematics';
import type { CharacterAutonomySnapshot } from '../../domain/character';
import type { BrainVisualEpisode } from '../main-autonomy-composition';

export interface BrainStateSource {
  readonly streamId: string;
  readonly revision: number;
  readonly sampledAtMs: number;
  readonly character: CharacterAutonomySnapshot;
  readonly motion: MotionState;
  readonly visualEpisode: BrainVisualEpisode;
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

function toBrainVisualIntentDTO(episode: BrainVisualEpisode): BrainVisualIntentDTO {
  const intent = episode.intent;
  return {
    episodeId: episode.id,
    episodeStartedAtMs: episode.startedAtMs,
    kind: intent.kind,
    category: intent.category,
    priority: intent.priority,
    interrupt: intent.interrupt,
    loop: intent.loop,
    emotionalTone: intent.emotionalTone,
    ...(intent.expressionHint === undefined ? {} : { expressionHint: intent.expressionHint }),
    ...(intent.gazeDirection === undefined ? {} : { gazeDirection: intent.gazeDirection }),
    ...(intent.propHint === undefined ? {} : { propHint: intent.propHint }),
  };
}

export function toBrainStateDTO(state: BrainStateSource): BrainStateDTO {
  return {
    streamId: state.streamId,
    revision: state.revision,
    sampledAtMs: state.sampledAtMs,
    character: {
      needs: {
        energy: state.character.needs.energy,
        attention: state.character.needs.attention,
        play: state.character.needs.play,
        comfort: state.character.needs.comfort,
        boredom: state.character.needs.boredom ?? 0,
      },
      synthesizedTone: state.character.synthesizedTone,
    },
    activity: null,
    motion: {
      phase: state.motion.phase,
      rootScreenPosition: { ...state.motion.position },
      velocityPxPerSec: { ...state.motion.velocityPxPerSec },
      positionAuthority: state.motion.phase === 'grounded' ? 'voluntary' : 'forced',
    },
    visualIntent: toBrainVisualIntentDTO(state.visualEpisode),
  };
}
