import type {
  IMotionEngine,
  MonotonicMs,
  MotionState,
  MotionStepResult,
  ScreenBoundsDto,
  Vector2Dto,
  WorldPx,
} from './motion-engine';

export type SurfaceKind = 'screen_floor' | 'window_top' | 'unknown';

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
  readonly isValidSupport: boolean;
}

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
  readonly supportY?: WorldPx;
  readonly locomotionVelocityPxPerSec: Vector2Dto;
}

export interface StartWallClimbInput {
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
  readonly state: SurfaceKinematicsState;
  readonly motion: MotionState;
  readonly environment: EnvironmentSnapshot;
  readonly nowMs: MonotonicMs;
}

export type SurfaceKinematicsEvent =
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
  public startWallClimb(input: StartWallClimbInput): SurfaceKinematicsResult | null {
    const surface = input.environment.currentSurface;
    if (
      !isUsableSurface(surface, 'screen_floor') ||
      !containsY(input.environment.screenBounds, input.motion.position.y) ||
      !isFiniteNumber(input.verticalSpeedPxPerSec)
    ) {
      return null;
    }

    const position = {
      x: wallX(input.environment.screenBounds, input.side),
      y: input.motion.position.y,
    };
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
    const position = {
      x: wallX(input.environment.screenBounds, input.state.wallSide),
      y: input.motion.position.y + input.state.locomotionVelocityPxPerSec.y * elapsedSec,
    };
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
