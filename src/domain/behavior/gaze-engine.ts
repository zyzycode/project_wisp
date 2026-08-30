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
}

export interface GazeInput {
  readonly nowMs: MonotonicMs;
  readonly deltaSec: number;
  readonly target: GazeTarget;
  readonly geometry: GazeGeometry;
}

/** Frame order in the `face_gaze` manifest animation. */
export type GazeDirection = 'left' | 'right' | 'up' | 'down';

export interface GazeConstraints {
  readonly attentionRadiusWorldPx: number;
  readonly deadZoneSourcePx: number;
  readonly maxCursorAgeMs: number;
}

export interface GazeState {
  readonly mode: 'tracking' | 'returning_to_neutral' | 'neutral';
  readonly target?: GazeTarget;
  /** Discrete direction consumed by face_gaze_00..03; down is neutral. */
  readonly direction: GazeDirection;
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
  attentionRadiusWorldPx: 280,
  deadZoneSourcePx: 12,
  maxCursorAgeMs: 250,
};

export const DEFAULT_CURSOR_REACTION_CONSTRAINTS: CursorReactionConstraints = {
  attentionRadiusWorldPx: 280,
  swatRadiusWorldPx: 64,
  swatDwellMs: 450,
  signalMaxAgeMs: 250,
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

function desiredDirection(input: GazeInput, constraints: GazeConstraints): GazeDirection {
  if (input.target.type === 'neutral') return 'down';
  if (
    input.target.type === 'cursor' &&
    !isFresh(input.target.sample, input.nowMs, constraints.maxCursorAgeMs)
  ) {
    return 'down';
  }

  const targetPosition =
    input.target.type === 'cursor'
      ? input.target.sample.globalPosition
      : input.target.globalPosition;
  const dxWorld = targetPosition.x - input.geometry.rootGlobalPosition.x;
  const dyWorld = targetPosition.y - input.geometry.rootGlobalPosition.y;
  const dxSource = dxWorld / input.geometry.scale;
  const dySource = dyWorld / input.geometry.scale;
  const dxLocal = (input.geometry.flipX ? -dxSource : dxSource) - input.geometry.gazeOriginSourcePx.x;
  const dyLocal = dySource - input.geometry.gazeOriginSourcePx.y;
  const distance = Math.hypot(dxLocal, dyLocal);
  const attentionRadiusSourcePx = input.geometry.scale === 0
    ? 0
    : constraints.attentionRadiusWorldPx / input.geometry.scale;

  // Cursor gaze is deliberately global: once a cursor is known, the face
  // holds its direction even when the pointer is far from the character.
  // World points retain the bounded-attention policy used by domain callers.
  if (
    (input.target.type !== 'cursor' && distance > attentionRadiusSourcePx) ||
    distance <= constraints.deadZoneSourcePx
  ) {
    return 'down';
  }
  if (Math.abs(dxLocal) >= Math.abs(dyLocal)) return dxLocal < 0 ? 'left' : 'right';
  return dyLocal < 0 ? 'up' : 'down';
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

    const direction = desiredDirection(input, constraints);
    const mode = direction === 'down' ? 'neutral' : 'tracking';
    return {
      mode,
      ...(mode === 'tracking' ? { target: input.target } : {}),
      direction,
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
