import { describe, expect, it } from 'vitest';
import type { EnvironmentSnapshot, MotionState } from '../../src/domain/behavior';
import {
  toEnvironmentSnapshot,
  toEnvironmentSnapshotDTO,
  toBrainStateDTO,
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

  it('maps one complete Brain snapshot with authoritative forced motion', () => {
    expect(
      toBrainStateDTO({
        streamId: 'stream-1',
        revision: 3,
        sampledAtMs: 50,
        character: {
          needs: { energy: 80, attention: 30, play: 40, comfort: 50, boredom: 10 },
          synthesizedTone: 'neutral',
        },
        motion,
        visualEpisode: {
          id: 'episode-3',
          startedAtMs: 40,
          intent: {
            kind: 'fall', category: 'movement', priority: 'normal', interrupt: 'no',
            loop: 'until_replaced', requestedBy: 'system', emotionalTone: 'neutral',
          },
        },
      })
    ).toEqual({
      streamId: 'stream-1',
      revision: 3,
      sampledAtMs: 50,
      character: {
        needs: { energy: 80, attention: 30, play: 40, comfort: 50, boredom: 10 },
        synthesizedTone: 'neutral',
      },
      activity: null,
      motion: {
        phase: 'airborne', rootScreenPosition: { x: 50, y: 60 },
        velocityPxPerSec: { x: 70, y: -80 }, positionAuthority: 'forced',
      },
      visualIntent: {
        episodeId: 'episode-3', episodeStartedAtMs: 40, kind: 'fall',
        category: 'movement', priority: 'normal', interrupt: 'no',
        loop: 'until_replaced', emotionalTone: 'neutral',
      },
    });
  });
});
