import type { ActivityDefinition } from './activity-runner';
import type { CollisionInsets, Vector2Dto } from './motion-engine';
import type { EnvironmentSnapshot } from './surface-kinematics';
import { cursorGameReachable } from './cursor-game';
/** The shared Activity runtime expands this entry into bounded legs and outcome phases. */
export function createCursorInterestActivity(input: {
  readonly root: Vector2Dto; readonly cursor: Vector2Dto; readonly environment: EnvironmentSnapshot;
  readonly collisionInsets: CollisionInsets;
}): ActivityDefinition | null {
  if (!cursorGameReachable({ ...input, cursor: { globalPosition: input.cursor, capturedAtMs: 0 }, dwellMs: 0 }, 0)) return null;
  return { id: 'cursor_interest', priority: 'P3_reactive', baseWeight: 1, cooldownKey: 'observe_cursor',
    tags: ['cursor'], entryStepId: 'notice', steps: [
      { id: 'notice', actionId: 'cursor_notice', type: 'animation', stage: 'entering', intent: { kind: 'look_around' },
        completion: { type: 'elapsed', durationMs: 600 } },
    ] };
}
