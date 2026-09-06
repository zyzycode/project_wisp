import type { BehaviorConfig, IPrng } from '../../domain/behavior/autonomous-behavior';
import type { CollisionInsets, ScreenBoundsDto, Vector2Dto } from '../../domain/behavior/motion-engine';
import type { SurfaceSnapshotDto } from '../../domain/behavior/surface-kinematics';

/** Target contract for a pure Domain function; no service registration is required. */
export interface WanderTargetPlanningInput {
  readonly currentPosition: Vector2Dto;
  readonly screenBounds: ScreenBoundsDto;
  readonly currentSurface?: SurfaceSnapshotDto;
  readonly collisionInsets: CollisionInsets;
  readonly prng: IPrng;
  readonly config: Readonly<BehaviorConfig>;
}

export interface PlannedWanderTarget {
  readonly target: Vector2Dto;
  readonly durationMs: number;
}

/** Domain owns support intersection, direction, distance and duration policy. */
export type WanderTargetPlanner = (input: WanderTargetPlanningInput) => PlannedWanderTarget;
