import type { MonotonicMs, Vector2Dto } from './motion-engine';

export type SourcePx = number;

export interface CursorSample {
  readonly globalPosition: Vector2Dto;
  readonly capturedAtMs: MonotonicMs;
}

export type GazeTarget =
  | { readonly type: 'cursor'; readonly sample: CursorSample }
  | { readonly type: 'world_point'; readonly globalPosition: Vector2Dto }
  | { readonly type: 'neutral' };

export interface GazeGeometry {
  readonly rootGlobalPosition: Vector2Dto;
  readonly gazeOriginSourcePx: Vector2Dto;
  readonly scale: number;
  readonly flipX: boolean;
  /** Inverse rendered linear transform; reflection is already included. */
  readonly sourceFromWorld?: { readonly xx: number; readonly xy: number; readonly yx: number; readonly yy: number };
}

export interface GazeInput {
  readonly nowMs: MonotonicMs;
  readonly deltaSec: number;
  readonly target: GazeTarget;
  readonly geometry: GazeGeometry;
}

/** Frame order in the `face_gaze` manifest animation. */
export type GazeDirection = 'left' | 'right' | 'up' | 'down';
export type GazePresentationDirection = GazeDirection | 'neutral';

export interface GazeConstraints {
  readonly attentionRadiusWorldPx: number;
  readonly deadZoneSourcePx: number;
  readonly maxCursorAgeMs: number;
  readonly smoothingTimeSec?: number;
  readonly directionHysteresis?: number;
}

export interface GazeState {
  readonly mode: 'tracking' | 'returning_to_neutral' | 'neutral';
  readonly target?: GazeTarget;
  /** Neutral uses the existing idle face, never the downward gaze frame. */
  readonly direction: GazePresentationDirection;
  readonly offset?: Vector2Dto;
  readonly updatedAtMs: MonotonicMs;
}

export interface IGazeEngine {
  update(previous: GazeState, input: GazeInput, constraints?: GazeConstraints): GazeState;
}

export interface CursorReactionConstraints {
  readonly attentionRadiusWorldPx: number;
  readonly swatRadiusWorldPx: number;
  readonly swatDwellMs: number;
  readonly signalMaxAgeMs: number;
  readonly swatCooldownKey: string;
}

export interface CursorProximitySignal {
  readonly cursor: CursorSample;
  readonly distanceToRootWorldPx: number;
  readonly withinAttentionRange: boolean;
  readonly withinSwatRange: boolean;
  readonly dwellWithinSwatRangeMs: number;
  readonly emittedAtMs: MonotonicMs;
}

export interface CursorProximityState {
  readonly withinSwatRange: boolean;
  readonly dwellWithinSwatRangeMs: number;
  readonly updatedAtMs: MonotonicMs;
}

export interface CursorProximityInput {
  readonly nowMs: MonotonicMs;
  readonly rootGlobalPosition: Vector2Dto;
  readonly cursor?: CursorSample;
  readonly compatible: boolean;
}

export interface CursorProximityUpdate {
  readonly state: CursorProximityState;
  readonly signal?: CursorProximitySignal;
}

export interface ICursorProximityEngine {
  update(
    previous: CursorProximityState,
    input: CursorProximityInput,
    constraints?: CursorReactionConstraints
  ): CursorProximityUpdate;
}

export const DEFAULT_GAZE_CONSTRAINTS: GazeConstraints = {
  attentionRadiusWorldPx: 360,
  deadZoneSourcePx: 12,
  maxCursorAgeMs: 300,
  smoothingTimeSec: 0.12,
  directionHysteresis: 0.15,
};

export const DEFAULT_CURSOR_REACTION_CONSTRAINTS: CursorReactionConstraints = {
  attentionRadiusWorldPx: 360,
  swatRadiusWorldPx: 64,
  swatDwellMs: 450,
  signalMaxAgeMs: 300,
  swatCooldownKey: 'swat_cursor',
};

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function requireNonNegative(value: number, name: string): void {
  requireFinite(value, name);
  if (value < 0) throw new RangeError(`${name} must be non-negative`);
}

function requirePositive(value: number, name: string): void {
  requireFinite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
}

function validateGazeConstraints(constraints: GazeConstraints): void {
  requirePositive(constraints.attentionRadiusWorldPx, 'attentionRadiusWorldPx');
  requireNonNegative(constraints.deadZoneSourcePx, 'deadZoneSourcePx');
  requireNonNegative(constraints.maxCursorAgeMs, 'maxCursorAgeMs');
  requirePositive(constraints.smoothingTimeSec ?? 0.12, 'smoothingTimeSec');
  requireNonNegative(constraints.directionHysteresis ?? 0.15, 'directionHysteresis');
}

function validateCursorConstraints(constraints: CursorReactionConstraints): void {
  requireNonNegative(constraints.attentionRadiusWorldPx, 'attentionRadiusWorldPx');
  requireNonNegative(constraints.swatRadiusWorldPx, 'swatRadiusWorldPx');
  requireNonNegative(constraints.swatDwellMs, 'swatDwellMs');
  requireNonNegative(constraints.signalMaxAgeMs, 'signalMaxAgeMs');
}

function isFresh(sample: CursorSample, nowMs: MonotonicMs, maxAgeMs: number): boolean {
  const ageMs = nowMs - sample.capturedAtMs;
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

function desiredOffset(input: GazeInput, constraints: GazeConstraints): Vector2Dto {
  if (input.target.type === 'neutral') return { x: 0, y: 0 };
  if (
    input.target.type === 'cursor' &&
    !isFresh(input.target.sample, input.nowMs, constraints.maxCursorAgeMs)
  ) {
    return { x: 0, y: 0 };
  }

  const targetPosition =
    input.target.type === 'cursor'
      ? input.target.sample.globalPosition
      : input.target.globalPosition;
  const dxWorld = targetPosition.x - input.geometry.rootGlobalPosition.x;
  const dyWorld = targetPosition.y - input.geometry.rootGlobalPosition.y;
  const inverse = input.geometry.sourceFromWorld;
  const dxSource = inverse === undefined ? (input.geometry.flipX ? -dxWorld : dxWorld) / input.geometry.scale
    : inverse.xx * dxWorld + inverse.xy * dyWorld;
  const dySource = inverse === undefined ? dyWorld / input.geometry.scale
    : inverse.yx * dxWorld + inverse.yy * dyWorld;
  const dxLocal = dxSource - input.geometry.gazeOriginSourcePx.x;
  const dyLocal = dySource - input.geometry.gazeOriginSourcePx.y;
  const distance = Math.hypot(dxLocal, dyLocal);
  const attentionRadiusSourcePx = input.geometry.scale === 0
    ? 0
    : constraints.attentionRadiusWorldPx / input.geometry.scale;

  if (
    distance > attentionRadiusSourcePx ||
    distance <= constraints.deadZoneSourcePx
  ) {
    return { x: 0, y: 0 };
  }
  const strength = (distance - constraints.deadZoneSourcePx) / (attentionRadiusSourcePx - constraints.deadZoneSourcePx);
  return { x: dxLocal / distance * strength, y: dyLocal / distance * strength };
}

function selectDirection(offset: Vector2Dto, previous: GazePresentationDirection, hysteresis: number): GazePresentationDirection {
  const x = Math.abs(offset.x), y = Math.abs(offset.y);
  if (Math.hypot(x, y) < 0.01) return 'neutral';
  const horizontal = offset.x < 0 ? 'left' : 'right';
  const vertical = offset.y < 0 ? 'up' : 'down';
  if (previous === horizontal && y <= x * (1 + hysteresis)) return previous;
  if (previous === vertical && x <= y * (1 + hysteresis)) return previous;
  return x >= y ? horizontal : vertical;
}

export class GazeEngine implements IGazeEngine {
  public update(
    previous: GazeState,
    input: GazeInput,
    constraints: GazeConstraints = DEFAULT_GAZE_CONSTRAINTS
  ): GazeState {
    validateGazeConstraints(constraints);
    requirePositive(input.geometry.scale, 'geometry.scale');
    requireNonNegative(input.deltaSec, 'deltaSec');
    if (constraints.attentionRadiusWorldPx <= constraints.deadZoneSourcePx * input.geometry.scale) {
      throw new RangeError('attentionRadiusWorldPx must exceed deadZoneSourcePx at the current scale');
    }
    if (input.nowMs < previous.updatedAtMs) {
      throw new RangeError('nowMs must not precede the previous gaze update');
    }

    const desired = desiredOffset(input, constraints);
    const previousOffset = previous.offset ?? { x: 0, y: 0 };
    const alpha = 1 - Math.exp(-input.deltaSec / (constraints.smoothingTimeSec ?? 0.12));
    const smoothed = { x: previousOffset.x + alpha * (desired.x - previousOffset.x),
      y: previousOffset.y + alpha * (desired.y - previousOffset.y) };
    const direction = selectDirection(smoothed, previous.direction, constraints.directionHysteresis ?? 0.15);
    const mode = desired.x !== 0 || desired.y !== 0 ? 'tracking'
      : direction === 'neutral' ? 'neutral' : 'returning_to_neutral';
    return {
      mode,
      ...(mode === 'tracking' ? { target: input.target } : {}),
      direction,
      offset: direction === 'neutral' ? { x: 0, y: 0 } : smoothed,
      updatedAtMs: input.nowMs,
    };
  }
}

export class CursorProximityEngine implements ICursorProximityEngine {
  public update(
    previous: CursorProximityState,
    input: CursorProximityInput,
    constraints: CursorReactionConstraints = DEFAULT_CURSOR_REACTION_CONSTRAINTS
  ): CursorProximityUpdate {
    validateCursorConstraints(constraints);
    if (input.nowMs < previous.updatedAtMs) {
      throw new RangeError('nowMs must not precede the previous cursor update');
    }

    const cursor = input.cursor;
    const elapsedMs = input.nowMs - previous.updatedAtMs;
    if (cursor === undefined || !isFresh(cursor, input.nowMs, constraints.signalMaxAgeMs)) {
      return {
        state: {
          ...previous,
          withinSwatRange: false,
          dwellWithinSwatRangeMs: 0,
          updatedAtMs: input.nowMs,
        },
      };
    }

    const distanceToRootWorldPx = Math.hypot(
      cursor.globalPosition.x - input.rootGlobalPosition.x,
      cursor.globalPosition.y - input.rootGlobalPosition.y
    );
    const withinSwatRange = input.compatible && distanceToRootWorldPx <= constraints.swatRadiusWorldPx;
    const dwellWithinSwatRangeMs = withinSwatRange
      ? (previous.withinSwatRange ? previous.dwellWithinSwatRangeMs + elapsedMs : 0)
      : 0;
    const state = {
      ...previous,
      withinSwatRange,
      dwellWithinSwatRangeMs,
      updatedAtMs: input.nowMs,
    };
    return {
      state,
      signal: {
        cursor,
        distanceToRootWorldPx,
        withinAttentionRange: distanceToRootWorldPx <= constraints.attentionRadiusWorldPx,
        withinSwatRange,
        dwellWithinSwatRangeMs,
        emittedAtMs: input.nowMs,
      },
    };
  }
}
