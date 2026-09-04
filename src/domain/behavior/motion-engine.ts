export type MonotonicMs = number;
export type WorldPx = number;

export interface Vector2Dto {
  readonly x: number;
  readonly y: number;
}

export type MotionPhase = 'dragged' | 'airborne' | 'grounded';
export type AirborneCause = 'throw_release' | 'voluntary_jump' | 'support_lost';

export interface AirborneLaunch {
  readonly cause: AirborneCause;
  readonly position: Vector2Dto;
  readonly velocityPxPerSec: Vector2Dto;
  readonly boundsId: string;
  readonly atMs: MonotonicMs;
}

export interface ThrowVector {
  readonly vxPxPerSec: number;
  readonly vyPxPerSec: number;
  readonly sampledAtMs: MonotonicMs;
  readonly sampleCount: number;
  readonly sampleSpanMs: number;
}

export interface ScreenBoundsDto {
  readonly id: string;
  readonly x: WorldPx;
  readonly y: WorldPx;
  readonly width: WorldPx;
  readonly height: WorldPx;
}

export interface CollisionInsets {
  readonly left: WorldPx;
  readonly right: WorldPx;
  readonly top: WorldPx;
  readonly bottom: WorldPx;
}

export interface ThrowSamplingConstraints {
  readonly windowMs: number;
  readonly maxSamples: number;
  readonly minSpanMs: number;
  readonly maxThrowSpeedPxPerSec: number;
}

export interface MotionConstraints {
  readonly gravityPxPerSec2: number;
  readonly linearDampingXPerSec: number;
  readonly linearDampingYPerSec: number;
  readonly fixedStepSec: number;
  readonly maxFrameDeltaSec: number;
  readonly maxSpeedPxPerSec: number;
  readonly wallRestitution: number;
  readonly ceilingRestitution: number;
  readonly floorRestitution: number;
  readonly floorTangentialRetention: number;
  readonly minBounceNormalSpeedPxPerSec: number;
  readonly settleNormalSpeedPxPerSec: number;
  readonly settleTangentialSpeedPxPerSec: number;
  readonly softLandingMaxSeverity: number;
  readonly stumbleMaxSeverity: number;
  readonly collisionInsets: CollisionInsets;
  readonly throwSampling: ThrowSamplingConstraints;
}

export type LandingOutcome = 'soft_landing' | 'stumble' | 'crash_landing';

export interface MotionState {
  readonly phase: MotionPhase;
  readonly position: Vector2Dto;
  readonly velocityPxPerSec: Vector2Dto;
  readonly activeBoundsId: string;
  readonly airborneElapsedSec: number;
  readonly peakGroundImpactSeverity: number;
}

export type MotionEvent =
  | { readonly type: 'drag_started'; readonly atMs: MonotonicMs }
  | { readonly type: 'released'; readonly throwVector: ThrowVector }
  | { readonly type: 'airborne_started'; readonly cause: AirborneCause; readonly atMs: MonotonicMs }
  | {
      readonly type: 'collision';
      readonly side: 'left' | 'right' | 'top' | 'bottom';
      readonly normalSpeedPxPerSec: number;
    }
  | { readonly type: 'landed'; readonly outcome: LandingOutcome; readonly impactSeverity: number };

export interface MotionStepResult {
  readonly state: MotionState;
  readonly events: readonly MotionEvent[];
}

export interface PointerMotionSample {
  readonly position: Vector2Dto;
  readonly capturedAtMs: MonotonicMs;
}

export interface MotionStepInput {
  readonly state: MotionState;
  readonly stepSec: number;
  readonly bounds: ScreenBoundsDto;
}

export interface IMotionEngine {
  beginDrag(
    state: MotionState,
    pivotPosition: Vector2Dto,
    boundsId: string,
    atMs: MonotonicMs
  ): MotionStepResult;
  updateDraggedPosition(state: MotionState, pivotPosition: Vector2Dto): MotionState;
  estimateThrow(samples: readonly PointerMotionSample[], releaseAtMs: MonotonicMs): ThrowVector;
  release(state: MotionState, throwVector: ThrowVector): MotionStepResult;
  beginAirborne(state: MotionState, launch: AirborneLaunch): MotionStepResult;
  step(input: MotionStepInput): MotionStepResult;
}

export const DEFAULT_MOTION_CONSTRAINTS: MotionConstraints = {
  gravityPxPerSec2: 1800,
  linearDampingXPerSec: 0.35,
  linearDampingYPerSec: 0.08,
  fixedStepSec: 1 / 120,
  maxFrameDeltaSec: 0.25,
  maxSpeedPxPerSec: 2400,
  wallRestitution: 0.45,
  ceilingRestitution: 0.3,
  floorRestitution: 0.3,
  floorTangentialRetention: 0.72,
  minBounceNormalSpeedPxPerSec: 160,
  settleNormalSpeedPxPerSec: 120,
  settleTangentialSpeedPxPerSec: 90,
  softLandingMaxSeverity: 420,
  stumbleMaxSeverity: 950,
  collisionInsets: { left: 50, right: 50, top: 90, bottom: 10 },
  throwSampling: {
    windowMs: 100,
    maxSamples: 8,
    minSpanMs: 24,
    maxThrowSpeedPxPerSec: 2200,
  },
};

const EPSILON = 1e-9;

export interface RootCollisionRange {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}

function requireNonNegative(value: number, name: string): void {
  requireFinite(value, name);
  if (value < 0) {
    throw new RangeError(`${name} must be non-negative`);
  }
}

function requirePositive(value: number, name: string): void {
  requireFinite(value, name);
  if (value <= 0) {
    throw new RangeError(`${name} must be positive`);
  }
}

function requireUnitInterval(value: number, name: string): void {
  requireFinite(value, name);
  if (value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }
}

function validateConstraints(constraints: MotionConstraints): void {
  requireNonNegative(constraints.gravityPxPerSec2, 'gravityPxPerSec2');
  requireNonNegative(constraints.linearDampingXPerSec, 'linearDampingXPerSec');
  requireNonNegative(constraints.linearDampingYPerSec, 'linearDampingYPerSec');
  requirePositive(constraints.fixedStepSec, 'fixedStepSec');
  requirePositive(constraints.maxFrameDeltaSec, 'maxFrameDeltaSec');
  requirePositive(constraints.maxSpeedPxPerSec, 'maxSpeedPxPerSec');
  requireUnitInterval(constraints.wallRestitution, 'wallRestitution');
  requireUnitInterval(constraints.ceilingRestitution, 'ceilingRestitution');
  requireUnitInterval(constraints.floorRestitution, 'floorRestitution');
  requireUnitInterval(constraints.floorTangentialRetention, 'floorTangentialRetention');
  requireNonNegative(
    constraints.minBounceNormalSpeedPxPerSec,
    'minBounceNormalSpeedPxPerSec'
  );
  requireNonNegative(constraints.settleNormalSpeedPxPerSec, 'settleNormalSpeedPxPerSec');
  requireNonNegative(
    constraints.settleTangentialSpeedPxPerSec,
    'settleTangentialSpeedPxPerSec'
  );
  requireNonNegative(constraints.softLandingMaxSeverity, 'softLandingMaxSeverity');
  requireNonNegative(constraints.stumbleMaxSeverity, 'stumbleMaxSeverity');
  requireNonNegative(constraints.collisionInsets.left, 'collisionInsets.left');
  requireNonNegative(constraints.collisionInsets.right, 'collisionInsets.right');
  requireNonNegative(constraints.collisionInsets.top, 'collisionInsets.top');
  requireNonNegative(constraints.collisionInsets.bottom, 'collisionInsets.bottom');
  requirePositive(constraints.throwSampling.windowMs, 'throwSampling.windowMs');
  requirePositive(constraints.throwSampling.maxSamples, 'throwSampling.maxSamples');
  if (!Number.isInteger(constraints.throwSampling.maxSamples)) {
    throw new RangeError('throwSampling.maxSamples must be an integer');
  }
  requireNonNegative(constraints.throwSampling.minSpanMs, 'throwSampling.minSpanMs');
  requirePositive(
    constraints.throwSampling.maxThrowSpeedPxPerSec,
    'throwSampling.maxThrowSpeedPxPerSec'
  );

  if (constraints.minBounceNormalSpeedPxPerSec < constraints.settleNormalSpeedPxPerSec) {
    throw new RangeError('minBounceNormalSpeedPxPerSec must be at least settleNormalSpeedPxPerSec');
  }
  if (constraints.softLandingMaxSeverity >= constraints.stumbleMaxSeverity) {
    throw new RangeError('softLandingMaxSeverity must be less than stumbleMaxSeverity');
  }
}

export function calculateRootCollisionRange(
  bounds: ScreenBoundsDto,
  insets: CollisionInsets
): RootCollisionRange {
  requireFinite(bounds.x, 'bounds.x');
  requireFinite(bounds.y, 'bounds.y');
  requirePositive(bounds.width, 'bounds.width');
  requirePositive(bounds.height, 'bounds.height');
  requireNonNegative(insets.left, 'collisionInsets.left');
  requireNonNegative(insets.right, 'collisionInsets.right');
  requireNonNegative(insets.top, 'collisionInsets.top');
  requireNonNegative(insets.bottom, 'collisionInsets.bottom');

  const limits = {
    minX: bounds.x + insets.left,
    maxX: bounds.x + bounds.width - insets.right,
    minY: bounds.y + insets.top,
    maxY: bounds.y + bounds.height - insets.bottom,
  };

  if (limits.minX > limits.maxX || limits.minY > limits.maxY) {
    throw new RangeError('collision insets must leave a non-empty range inside bounds');
  }

  return limits;
}

export function clampRootPosition(
  position: Vector2Dto,
  bounds: ScreenBoundsDto,
  insets: CollisionInsets
): Vector2Dto {
  requireFinite(position.x, 'position.x');
  requireFinite(position.y, 'position.y');
  const range = calculateRootCollisionRange(bounds, insets);
  return {
    x: Math.min(range.maxX, Math.max(range.minX, position.x)),
    y: Math.min(range.maxY, Math.max(range.minY, position.y)),
  };
}

function clampMagnitude(vector: Vector2Dto, maximum: number): Vector2Dto {
  const speed = Math.hypot(vector.x, vector.y);
  const scale = Math.min(1, maximum / Math.max(speed, EPSILON));
  return { x: vector.x * scale, y: vector.y * scale };
}

function landingOutcome(severity: number, constraints: MotionConstraints): LandingOutcome {
  if (severity <= constraints.softLandingMaxSeverity) {
    return 'soft_landing';
  }
  if (severity <= constraints.stumbleMaxSeverity) {
    return 'stumble';
  }
  return 'crash_landing';
}

export class MotionEngine implements IMotionEngine {
  public constructor(private readonly constraints: MotionConstraints = DEFAULT_MOTION_CONSTRAINTS) {
    validateConstraints(constraints);
  }

  public beginDrag(
    state: MotionState,
    pivotPosition: Vector2Dto,
    boundsId: string,
    atMs: MonotonicMs
  ): MotionStepResult {
    return {
      state: {
        ...state,
        phase: 'dragged',
        position: pivotPosition,
        velocityPxPerSec: { x: 0, y: 0 },
        activeBoundsId: boundsId,
        airborneElapsedSec: 0,
        peakGroundImpactSeverity: 0,
      },
      events: [{ type: 'drag_started', atMs }],
    };
  }

  public updateDraggedPosition(state: MotionState, pivotPosition: Vector2Dto): MotionState {
    return {
      ...state,
      position: pivotPosition,
      velocityPxPerSec: { x: 0, y: 0 },
    };
  }

  public estimateThrow(
    samples: readonly PointerMotionSample[],
    releaseAtMs: MonotonicMs
  ): ThrowVector {
    const byTimestamp = new Map<number, PointerMotionSample>();
    const ordered = [...samples].sort((left, right) => left.capturedAtMs - right.capturedAtMs);

    for (const sample of ordered) {
      if (
        Number.isFinite(sample.capturedAtMs) &&
        Number.isFinite(sample.position.x) &&
        Number.isFinite(sample.position.y)
      ) {
        byTimestamp.set(sample.capturedAtMs, sample);
      }
    }

    const cutoffMs = releaseAtMs - this.constraints.throwSampling.windowMs;
    const eligible = [...byTimestamp.values()]
      .filter((sample) => sample.capturedAtMs >= cutoffMs && sample.capturedAtMs <= releaseAtMs)
      .slice(-this.constraints.throwSampling.maxSamples);
    const first = eligible[0];
    const last = eligible[eligible.length - 1];
    const sampleSpanMs = first && last ? last.capturedAtMs - first.capturedAtMs : 0;

    if (
      eligible.length < 2 ||
      sampleSpanMs < this.constraints.throwSampling.minSpanMs ||
      !first ||
      !last
    ) {
      return {
        vxPxPerSec: 0,
        vyPxPerSec: 0,
        sampledAtMs: releaseAtMs,
        sampleCount: eligible.length,
        sampleSpanMs,
      };
    }

    let totalWeight = 0;
    let weightedTime = 0;
    let weightedX = 0;
    let weightedY = 0;
    for (let index = 0; index < eligible.length; index += 1) {
      const sample = eligible[index];
      if (!sample) {
        continue;
      }
      const weight = index + 1;
      const timeSec = (sample.capturedAtMs - last.capturedAtMs) / 1000;
      totalWeight += weight;
      weightedTime += weight * timeSec;
      weightedX += weight * sample.position.x;
      weightedY += weight * sample.position.y;
    }

    const meanTime = weightedTime / totalWeight;
    const meanX = weightedX / totalWeight;
    const meanY = weightedY / totalWeight;
    let denominator = 0;
    let numeratorX = 0;
    let numeratorY = 0;
    for (let index = 0; index < eligible.length; index += 1) {
      const sample = eligible[index];
      if (!sample) {
        continue;
      }
      const weight = index + 1;
      const timeDelta = (sample.capturedAtMs - last.capturedAtMs) / 1000 - meanTime;
      denominator += weight * timeDelta * timeDelta;
      numeratorX += weight * timeDelta * (sample.position.x - meanX);
      numeratorY += weight * timeDelta * (sample.position.y - meanY);
    }

    const rawVelocity =
      denominator <= EPSILON
        ? { x: 0, y: 0 }
        : { x: numeratorX / denominator, y: numeratorY / denominator };
    const velocity = clampMagnitude(
      rawVelocity,
      this.constraints.throwSampling.maxThrowSpeedPxPerSec
    );

    return {
      vxPxPerSec: velocity.x,
      vyPxPerSec: velocity.y,
      sampledAtMs: releaseAtMs,
      sampleCount: eligible.length,
      sampleSpanMs,
    };
  }

  public release(state: MotionState, throwVector: ThrowVector): MotionStepResult {
    const airborne = this.beginAirborne(state, {
      cause: 'throw_release',
      position: state.position,
      velocityPxPerSec: {
        x: throwVector.vxPxPerSec,
        y: throwVector.vyPxPerSec,
      },
      boundsId: state.activeBoundsId,
      atMs: throwVector.sampledAtMs,
    });

    return {
      state: airborne.state,
      events: [{ type: 'released', throwVector }, ...airborne.events],
    };
  }

  public beginAirborne(state: MotionState, launch: AirborneLaunch): MotionStepResult {
    return {
      state: {
        ...state,
        phase: 'airborne',
        position: launch.position,
        velocityPxPerSec: clampMagnitude(
          launch.velocityPxPerSec,
          this.constraints.maxSpeedPxPerSec
        ),
        activeBoundsId: launch.boundsId,
        airborneElapsedSec: 0,
        peakGroundImpactSeverity: 0,
      },
      events: [{ type: 'airborne_started', cause: launch.cause, atMs: launch.atMs }],
    };
  }

  public step(input: MotionStepInput): MotionStepResult {
    requirePositive(input.stepSec, 'stepSec');
    const limits = calculateRootCollisionRange(input.bounds, this.constraints.collisionInsets);
    if (input.state.phase !== 'airborne') {
      return { state: input.state, events: [] };
    }

    const velocity = clampMagnitude(
      {
        x:
          input.state.velocityPxPerSec.x *
          Math.exp(-this.constraints.linearDampingXPerSec * input.stepSec),
        y:
          (input.state.velocityPxPerSec.y +
            this.constraints.gravityPxPerSec2 * input.stepSec) *
          Math.exp(-this.constraints.linearDampingYPerSec * input.stepSec),
      },
      this.constraints.maxSpeedPxPerSec
    );
    let x = input.state.position.x + velocity.x * input.stepSec;
    let y = input.state.position.y + velocity.y * input.stepSec;
    let vx = velocity.x;
    let vy = velocity.y;
    let peakSeverity = input.state.peakGroundImpactSeverity;
    const events: MotionEvent[] = [];

    if (x < limits.minX) {
      const normalSpeed = Math.max(0, -vx);
      x = limits.minX;
      if (vx < 0) {
        vx = -this.constraints.wallRestitution * vx;
      }
      events.push({ type: 'collision', side: 'left', normalSpeedPxPerSec: normalSpeed });
    } else if (x > limits.maxX) {
      const normalSpeed = Math.max(0, vx);
      x = limits.maxX;
      if (vx > 0) {
        vx = -this.constraints.wallRestitution * vx;
      }
      events.push({ type: 'collision', side: 'right', normalSpeedPxPerSec: normalSpeed });
    }

    if (y < limits.minY) {
      const normalSpeed = Math.max(0, -vy);
      y = limits.minY;
      if (vy < 0) {
        vy = -this.constraints.ceilingRestitution * vy;
      }
      events.push({ type: 'collision', side: 'top', normalSpeedPxPerSec: normalSpeed });
    } else if (y >= limits.maxY) {
      const normalImpact = Math.max(0, vy);
      const impactSeverity = Math.hypot(normalImpact, 0.5 * Math.abs(vx));
      peakSeverity = Math.max(peakSeverity, impactSeverity);
      y = limits.maxY;
      events.push({ type: 'collision', side: 'bottom', normalSpeedPxPerSec: normalImpact });

      if (vy > 0 && normalImpact > this.constraints.minBounceNormalSpeedPxPerSec) {
        vy = -this.constraints.floorRestitution * vy;
        vx *= this.constraints.floorTangentialRetention;
      } else {
        if (vy > 0) {
          vy = 0;
        }
        vx *= this.constraints.floorTangentialRetention;

        if (
          normalImpact <= this.constraints.settleNormalSpeedPxPerSec &&
          Math.abs(vx) <= this.constraints.settleTangentialSpeedPxPerSec
        ) {
          const outcome = landingOutcome(peakSeverity, this.constraints);
          return {
            state: {
              ...input.state,
              phase: 'grounded',
              position: { x, y },
              velocityPxPerSec: { x: 0, y: 0 },
              activeBoundsId: input.bounds.id,
              airborneElapsedSec: input.state.airborneElapsedSec + input.stepSec,
              peakGroundImpactSeverity: peakSeverity,
            },
            events: [...events, { type: 'landed', outcome, impactSeverity: peakSeverity }],
          };
        }
      }
    }

    return {
      state: {
        ...input.state,
        position: { x, y },
        velocityPxPerSec: { x: vx, y: vy },
        activeBoundsId: input.bounds.id,
        airborneElapsedSec: input.state.airborneElapsedSec + input.stepSec,
        peakGroundImpactSeverity: peakSeverity,
      },
      events,
    };
  }
}
