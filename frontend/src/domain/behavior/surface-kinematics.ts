import { DEFAULT_MOTION_CONSTRAINTS, type CollisionInsets } from './motion-engine';
import { isExternalSurface, isFreshExternalObservation, isRootInsideEnvironment } from './external-surface-support';
import type {
  IMotionEngine,
  RootCollisionRange,
  MonotonicMs,
  MotionState,
  MotionStepResult,
  ScreenBoundsDto,
  Vector2Dto,
  WorldPx,
} from './motion-engine';

export type SurfaceKind = 'screen_floor' | 'window_top' | 'window_side' | 'unknown';

export interface SurfaceBoundsDto {
  readonly x: WorldPx;
  readonly y: WorldPx;
  readonly width: WorldPx;
  readonly height: WorldPx;
}

export interface SurfaceSnapshotDto {
  readonly id: string;
  readonly kind: SurfaceKind;
  readonly bounds: SurfaceBoundsDto;
  readonly supportY?: WorldPx;
  /** Required for window_side; absent for other kinds. Target AUTO-A07 contract. */
  readonly side?: WallSide;
  readonly isValidSupport: boolean;
}

/** Target external geometry; discovery and attachment are implemented separately. */
export type ExternalWindowSurface = SurfaceSnapshotDto & (
  | { readonly kind: 'window_top'; readonly supportY: WorldPx; readonly side?: never }
  | { readonly kind: 'window_side'; readonly side: WallSide; readonly supportY?: never }
);

export interface EnvironmentSnapshot {
  readonly capturedAtMs: MonotonicMs;
  readonly screenBounds: ScreenBoundsDto;
  readonly currentSurface?: SurfaceSnapshotDto;
}

export type WallSide = 'left' | 'right';
export type SurfaceMotionPhase = 'grounded' | 'climbing_wall' | 'hanging_ceiling' | 'airborne';

export interface SurfaceKinematicsState {
  readonly phase: SurfaceMotionPhase;
  readonly updatedAtMs: MonotonicMs;
  readonly surfaceId?: string;
  readonly wallSide?: WallSide;
  readonly climbLimits?: RootCollisionRange;
  readonly externalAttachment?: { readonly surface: ExternalWindowSurface; readonly localDistancePx: number };
  readonly supportY?: WorldPx;
  readonly locomotionVelocityPxPerSec: Vector2Dto;
}

export interface StartWallClimbInput {
  readonly climbLimits?: RootCollisionRange;
  readonly motion: MotionState;
  readonly environment: EnvironmentSnapshot;
  readonly side: WallSide;
  readonly verticalSpeedPxPerSec: number;
  readonly nowMs: MonotonicMs;
}

export interface StartCeilingHangInput {
  readonly motion: MotionState;
  readonly environment: EnvironmentSnapshot;
  readonly crawlSpeedPxPerSec: number;
  readonly nowMs: MonotonicMs;
}

export interface SurfaceKinematicsStepInput {
  readonly collisionInsets?: CollisionInsets;
  readonly observationNowMs?: MonotonicMs;
  readonly state: SurfaceKinematicsState;
  readonly motion: MotionState;
  readonly environment: EnvironmentSnapshot;
  readonly nowMs: MonotonicMs;
}

export type SurfaceKinematicsEvent =
  | { readonly type: 'wall_limit_reached'; readonly end: 'top' | 'floor' }
  | { readonly type: 'wall_climbed'; readonly side: WallSide }
  | { readonly type: 'ceiling_hung'; readonly surfaceId: string }
  | { readonly type: 'support_lost'; readonly surfaceId: string; readonly atMs: MonotonicMs };

export interface SurfaceKinematicsResult {
  readonly state: SurfaceKinematicsState;
  readonly motion: MotionStepResult;
  readonly events: readonly SurfaceKinematicsEvent[];
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function isUsableSurface(
  surface: SurfaceSnapshotDto | undefined,
  kind: SurfaceKind
): surface is SurfaceSnapshotDto {
  return surface?.kind === kind && surface.isValidSupport === true;
}

function containsX(bounds: SurfaceBoundsDto, x: number): boolean {
  return x >= bounds.x && x <= bounds.x + bounds.width;
}

function containsY(bounds: ScreenBoundsDto, y: number): boolean {
  return y >= bounds.y && y <= bounds.y + bounds.height;
}

function wallX(bounds: ScreenBoundsDto, side: WallSide): number {
  return side === 'left' ? bounds.x : bounds.x + bounds.width;
}

function unchangedMotion(state: MotionState): MotionStepResult {
  return { state, events: [] };
}

/**
 * Pure surface attachment rules. Environment adapters provide snapshots; this
 * service neither discovers windows nor owns the fixed-step airborne physics.
 */
export class SurfaceKinematics {
  public startExternalSupport(input: {
    readonly motion: MotionState; readonly environment: EnvironmentSnapshot;
    readonly nowMs: MonotonicMs; readonly observationNowMs: MonotonicMs;
    readonly collisionInsets: CollisionInsets;
  }): SurfaceKinematicsResult | null {
    const surface = input.environment.currentSurface;
    if (!isExternalSurface(surface) || !isFreshExternalObservation(input.environment.capturedAtMs, input.observationNowMs)) return null;
    const localDistancePx = surface.kind === 'window_top'
      ? input.motion.position.x - surface.bounds.x : input.motion.position.y - surface.bounds.y;
    const length = surface.kind === 'window_top' ? surface.bounds.width : surface.bounds.height;
    const position = surface.kind === 'window_top' ? { x: input.motion.position.x, y: surface.supportY }
      : { x: surface.side === 'left' ? surface.bounds.x : surface.bounds.x + surface.bounds.width, y: input.motion.position.y };
    if (localDistancePx < 0 || localDistancePx > length || !isRootInsideEnvironment(position, input.environment, input.collisionInsets)) return null;
    return {
      state: { phase: surface.kind === 'window_top' ? 'hanging_ceiling' : 'climbing_wall',
        surfaceId: surface.id, updatedAtMs: input.nowMs, supportY: surface.bounds.y,
        externalAttachment: { surface: { ...surface, bounds: { ...surface.bounds } }, localDistancePx },
        locomotionVelocityPxPerSec: { x: 0, y: 0 } },
      motion: unchangedMotion({ ...input.motion, phase: 'grounded', position, velocityPxPerSec: { x: 0, y: 0 },
        activeBoundsId: input.environment.screenBounds.id, directedJump: undefined, peakGroundImpactSeverity: 0 }),
      events: surface.kind === 'window_top' ? [{ type: 'ceiling_hung', surfaceId: surface.id }]
        : [{ type: 'wall_climbed', side: surface.side }],
    };
  }

  private stepExternalSupport(input: SurfaceKinematicsStepInput, engine: IMotionEngine): SurfaceKinematicsResult {
    // Drag discards attachment before any support-lost decision.
    if (input.motion.phase === 'dragged') return { state: { phase: 'grounded', updatedAtMs: input.nowMs,
      locomotionVelocityPxPerSec: { x: 0, y: 0 } }, motion: unchangedMotion(input.motion), events: [] };
    const attachment = input.state.externalAttachment!;
    const surface = input.environment.currentSurface;
    if (!isExternalSurface(surface) || surface.id !== attachment.surface.id || surface.kind !== attachment.surface.kind
        || surface.side !== attachment.surface.side || !isFreshExternalObservation(input.environment.capturedAtMs, input.observationNowMs ?? input.nowMs)) {
      return this.loseSupport(input, engine);
    }
    const speed = surface.kind === 'window_top' ? input.state.locomotionVelocityPxPerSec.x : input.state.locomotionVelocityPxPerSec.y;
    const localDistancePx = attachment.localDistancePx + speed * (input.nowMs - input.state.updatedAtMs) / 1000;
    const length = surface.kind === 'window_top' ? surface.bounds.width : surface.bounds.height;
    const position = surface.kind === 'window_top'
      ? { x: surface.bounds.x + localDistancePx, y: surface.bounds.y }
      : { x: surface.side === 'left' ? surface.bounds.x : surface.bounds.x + surface.bounds.width, y: surface.bounds.y + localDistancePx };
    if (localDistancePx < 0 || localDistancePx > length
        || !isRootInsideEnvironment(position, input.environment, input.collisionInsets ?? DEFAULT_MOTION_CONSTRAINTS.collisionInsets)) {
      return this.loseSupport(input, engine);
    }
    return { state: { ...input.state, updatedAtMs: input.nowMs, supportY: surface.bounds.y,
      externalAttachment: { surface: { ...surface, bounds: { ...surface.bounds } }, localDistancePx } },
      motion: unchangedMotion({ ...input.motion, position, velocityPxPerSec: input.state.locomotionVelocityPxPerSec }), events: [] };
  }

  public startWallClimb(input: StartWallClimbInput): SurfaceKinematicsResult | null {
    const surface = input.environment.currentSurface;
    if (
      !isUsableSurface(surface, 'screen_floor') ||
      !containsY(input.environment.screenBounds, input.motion.position.y) ||
      !isFiniteNumber(input.verticalSpeedPxPerSec)
    ) {
      return null;
    }

    const limits = input.climbLimits;
    const x = limits === undefined ? wallX(input.environment.screenBounds, input.side)
      : input.side === 'left' ? limits.minX : limits.maxX;
    if (limits !== undefined && (Math.abs(input.motion.position.x - x) > 1
        || input.motion.position.y < limits.minY || input.motion.position.y > limits.maxY)) return null;
    const position = { x, y: input.motion.position.y };
    const motion = {
      ...input.motion,
      phase: 'grounded' as const,
      position,
      velocityPxPerSec: { x: 0, y: input.verticalSpeedPxPerSec },
      activeBoundsId: input.environment.screenBounds.id,
    };

    return {
      state: {
        phase: 'climbing_wall',
        updatedAtMs: input.nowMs,
        surfaceId: surface.id,
        wallSide: input.side,
        climbLimits: input.climbLimits,
        locomotionVelocityPxPerSec: { x: 0, y: input.verticalSpeedPxPerSec },
      },
      motion: unchangedMotion(motion),
      events: [{ type: 'wall_climbed', side: input.side }],
    };
  }

  public startCeilingHang(input: StartCeilingHangInput): SurfaceKinematicsResult | null {
    const surface = input.environment.currentSurface;
    if (
      !isUsableSurface(surface, 'window_top') ||
      surface.supportY === undefined ||
      !containsX(surface.bounds, input.motion.position.x) ||
      !isFiniteNumber(input.crawlSpeedPxPerSec)
    ) {
      return null;
    }

    const position = { x: input.motion.position.x, y: surface.supportY };
    const motion = {
      ...input.motion,
      phase: 'grounded' as const,
      position,
      velocityPxPerSec: { x: input.crawlSpeedPxPerSec, y: 0 },
      activeBoundsId: input.environment.screenBounds.id,
    };

    return {
      state: {
        phase: 'hanging_ceiling',
        updatedAtMs: input.nowMs,
        surfaceId: surface.id,
        supportY: surface.supportY,
        locomotionVelocityPxPerSec: { x: input.crawlSpeedPxPerSec, y: 0 },
      },
      motion: unchangedMotion(motion),
      events: [{ type: 'ceiling_hung', surfaceId: surface.id }],
    };
  }

  public step(input: SurfaceKinematicsStepInput, motionEngine: IMotionEngine): SurfaceKinematicsResult {
    if (input.nowMs < input.state.updatedAtMs) {
      throw new RangeError('nowMs must not precede the previous surface update');
    }

    if (input.state.externalAttachment !== undefined) return this.stepExternalSupport(input, motionEngine);
    if (input.state.phase === 'climbing_wall') {
      return this.stepWallClimb(input, motionEngine);
    }
    if (input.state.phase === 'hanging_ceiling') {
      return this.stepCeilingHang(input, motionEngine);
    }

    return { state: input.state, motion: unchangedMotion(input.motion), events: [] };
  }

  private stepWallClimb(
    input: SurfaceKinematicsStepInput,
    motionEngine: IMotionEngine
  ): SurfaceKinematicsResult {
    const surface = input.environment.currentSurface;
    if (
      !isUsableSurface(surface, 'screen_floor') ||
      surface.id !== input.state.surfaceId ||
      input.state.wallSide === undefined
    ) {
      return this.loseSupport(input, motionEngine);
    }

    const elapsedSec = (input.nowMs - input.state.updatedAtMs) / 1000;
    const limits = input.state.climbLimits;
    const position = {
      x: limits === undefined ? wallX(input.environment.screenBounds, input.state.wallSide)
        : input.state.wallSide === 'left' ? limits.minX : limits.maxX,
      y: input.motion.position.y + input.state.locomotionVelocityPxPerSec.y * elapsedSec,
    };
    const speed = input.state.locomotionVelocityPxPerSec.y;
    if (limits !== undefined && ((speed < 0 && position.y <= limits.minY) || (speed > 0 && position.y >= limits.maxY))) {
      const end = speed < 0 ? 'top' : 'floor';
      const velocity = { x: 0, y: 0 };
      return {
        state: { ...input.state, phase: end === 'floor' ? 'grounded' : 'climbing_wall',
          updatedAtMs: input.nowMs, locomotionVelocityPxPerSec: velocity },
        motion: unchangedMotion({ ...input.motion, position: { x: position.x, y: end === 'top' ? limits.minY : limits.maxY },
          velocityPxPerSec: velocity }),
        events: [{ type: 'wall_limit_reached', end }],
      };
    }
    if (!containsY(input.environment.screenBounds, position.y)) {
      return this.loseSupport(input, motionEngine, position);
    }

    const motion = {
      ...input.motion,
      phase: 'grounded' as const,
      position,
      velocityPxPerSec: input.state.locomotionVelocityPxPerSec,
      activeBoundsId: input.environment.screenBounds.id,
    };
    return {
      state: { ...input.state, updatedAtMs: input.nowMs },
      motion: unchangedMotion(motion),
      events: [],
    };
  }

  private stepCeilingHang(
    input: SurfaceKinematicsStepInput,
    motionEngine: IMotionEngine
  ): SurfaceKinematicsResult {
    const surface = input.environment.currentSurface;
    const elapsedSec = (input.nowMs - input.state.updatedAtMs) / 1000;
    const position = {
      x: input.motion.position.x + input.state.locomotionVelocityPxPerSec.x * elapsedSec,
      y: input.motion.position.y,
    };
    if (
      !isUsableSurface(surface, 'window_top') ||
      surface.id !== input.state.surfaceId ||
      surface.supportY === undefined ||
      surface.supportY !== input.state.supportY ||
      !containsX(surface.bounds, position.x)
    ) {
      return this.loseSupport(input, motionEngine, position);
    }

    const motion = {
      ...input.motion,
      phase: 'grounded' as const,
      position: { x: position.x, y: surface.supportY },
      velocityPxPerSec: input.state.locomotionVelocityPxPerSec,
      activeBoundsId: input.environment.screenBounds.id,
    };
    return {
      state: { ...input.state, updatedAtMs: input.nowMs },
      motion: unchangedMotion(motion),
      events: [],
    };
  }

  private loseSupport(
    input: SurfaceKinematicsStepInput,
    motionEngine: IMotionEngine,
    position: Vector2Dto = input.motion.position
  ): SurfaceKinematicsResult {
    const surfaceId = input.state.surfaceId ?? 'unknown';
    const motion = motionEngine.beginAirborne(input.motion, {
      cause: 'support_lost',
      position,
      velocityPxPerSec: input.state.locomotionVelocityPxPerSec,
      boundsId: input.environment.screenBounds.id,
      atMs: input.nowMs,
    });
    return {
      state: {
        phase: 'airborne',
        updatedAtMs: input.nowMs,
        locomotionVelocityPxPerSec: motion.state.velocityPxPerSec,
      },
      motion,
      events: [{ type: 'support_lost', surfaceId, atMs: input.nowMs }],
    };
  }
}
