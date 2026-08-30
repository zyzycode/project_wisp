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

export interface PupilOffset {
  readonly xSourcePx: SourcePx;
  readonly ySourcePx: SourcePx;
}

export interface GazeConstraints {
  readonly attentionRadiusWorldPx: number;
  readonly deadZoneSourcePx: number;
  readonly maxPupilOffsetXSourcePx: number;
  readonly maxPupilOffsetYSourcePx: number;
  readonly smoothingTimeSec: number;
  readonly maxCursorAgeMs: number;
}

export interface GazeState {
  readonly mode: 'tracking' | 'returning_to_neutral' | 'neutral';
  readonly target?: GazeTarget;
  readonly pupilOffset: PupilOffset;
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
  readonly swatCooldownMs: number;
}

export interface CursorProximitySignal {
  readonly cursor: CursorSample;
  readonly distanceToRootWorldPx: number;
  readonly withinAttentionRange: boolean;
  readonly withinSwatRange: boolean;
  readonly dwellWithinSwatRangeMs: number;
  readonly emittedAtMs: MonotonicMs;
  readonly isSwatReady: boolean;
}

export interface CursorProximityState {
  readonly withinSwatRange: boolean;
  readonly dwellWithinSwatRangeMs: number;
  readonly updatedAtMs: MonotonicMs;
  readonly swatCooldownUntilMs: MonotonicMs;
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
  beginSwatCooldown(
    state: CursorProximityState,
    nowMs: MonotonicMs,
    constraints?: CursorReactionConstraints
  ): CursorProximityState;
}

export const DEFAULT_GAZE_CONSTRAINTS: GazeConstraints = {
  attentionRadiusWorldPx: 280,
  deadZoneSourcePx: 12,
  maxPupilOffsetXSourcePx: 14,
  maxPupilOffsetYSourcePx: 10,
  smoothingTimeSec: 0.08,
  maxCursorAgeMs: 250,
};

export const DEFAULT_CURSOR_REACTION_CONSTRAINTS: CursorReactionConstraints = {
  attentionRadiusWorldPx: 280,
  swatRadiusWorldPx: 64,
  swatDwellMs: 450,
  signalMaxAgeMs: 250,
  swatCooldownKey: 'swat_cursor',
  swatCooldownMs: 15_000,
};

const EPSILON = 1e-9;

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
  requirePositive(constraints.maxPupilOffsetXSourcePx, 'maxPupilOffsetXSourcePx');
  requirePositive(constraints.maxPupilOffsetYSourcePx, 'maxPupilOffsetYSourcePx');
  requirePositive(constraints.smoothingTimeSec, 'smoothingTimeSec');
  requireNonNegative(constraints.maxCursorAgeMs, 'maxCursorAgeMs');
}

function validateCursorConstraints(constraints: CursorReactionConstraints): void {
  requireNonNegative(constraints.attentionRadiusWorldPx, 'attentionRadiusWorldPx');
  requireNonNegative(constraints.swatRadiusWorldPx, 'swatRadiusWorldPx');
  requireNonNegative(constraints.swatDwellMs, 'swatDwellMs');
  requireNonNegative(constraints.signalMaxAgeMs, 'signalMaxAgeMs');
  requireNonNegative(constraints.swatCooldownMs, 'swatCooldownMs');
}

function isFresh(sample: CursorSample, nowMs: MonotonicMs, maxAgeMs: number): boolean {
  const ageMs = nowMs - sample.capturedAtMs;
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

function neutralOffset(): PupilOffset {
  return { xSourcePx: 0, ySourcePx: 0 };
}

function isNeutral(offset: PupilOffset): boolean {
  return Math.abs(offset.xSourcePx) <= EPSILON && Math.abs(offset.ySourcePx) <= EPSILON;
}

function desiredOffset(input: GazeInput, constraints: GazeConstraints): PupilOffset | null {
  if (input.target.type === 'neutral') return neutralOffset();
  if (
    input.target.type === 'cursor' &&
    !isFresh(input.target.sample, input.nowMs, constraints.maxCursorAgeMs)
  ) {
    return neutralOffset();
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

  if (distance > attentionRadiusSourcePx || distance <= constraints.deadZoneSourcePx) {
    return neutralOffset();
  }

  const strength = Math.min(
    1,
    Math.max(
      0,
      (distance - constraints.deadZoneSourcePx) /
        Math.max(attentionRadiusSourcePx - constraints.deadZoneSourcePx, EPSILON)
    )
  );
  let x = (dxLocal / distance) * constraints.maxPupilOffsetXSourcePx * strength;
  let y = (dyLocal / distance) * constraints.maxPupilOffsetYSourcePx * strength;
  const normalizedRadius = Math.hypot(
    x / constraints.maxPupilOffsetXSourcePx,
    y / constraints.maxPupilOffsetYSourcePx
  );
  if (normalizedRadius > 1) {
    x /= normalizedRadius;
    y /= normalizedRadius;
  }
  return { xSourcePx: x, ySourcePx: y };
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
    if (desired === null) return { ...previous, updatedAtMs: input.nowMs };
    const alpha = 1 - Math.exp(-input.deltaSec / constraints.smoothingTimeSec);
    const pupilOffset = {
      xSourcePx: previous.pupilOffset.xSourcePx + alpha * (desired.xSourcePx - previous.pupilOffset.xSourcePx),
      ySourcePx: previous.pupilOffset.ySourcePx + alpha * (desired.ySourcePx - previous.pupilOffset.ySourcePx),
    };
    const mode = isNeutral(desired)
      ? (isNeutral(pupilOffset) ? 'neutral' : 'returning_to_neutral')
      : 'tracking';
    return {
      mode,
      ...(mode === 'tracking' ? { target: input.target } : {}),
      pupilOffset,
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
    const isSwatReady =
      withinSwatRange &&
      dwellWithinSwatRangeMs >= constraints.swatDwellMs &&
      input.nowMs >= state.swatCooldownUntilMs;
    return {
      state,
      signal: {
        cursor,
        distanceToRootWorldPx,
        withinAttentionRange: distanceToRootWorldPx <= constraints.attentionRadiusWorldPx,
        withinSwatRange,
        dwellWithinSwatRangeMs,
        emittedAtMs: input.nowMs,
        isSwatReady,
      },
    };
  }

  public beginSwatCooldown(
    state: CursorProximityState,
    nowMs: MonotonicMs,
    constraints: CursorReactionConstraints = DEFAULT_CURSOR_REACTION_CONSTRAINTS
  ): CursorProximityState {
    validateCursorConstraints(constraints);
    if (nowMs < state.updatedAtMs) {
      throw new RangeError('nowMs must not precede the previous cursor update');
    }
    return { ...state, updatedAtMs: nowMs, swatCooldownUntilMs: nowMs + constraints.swatCooldownMs };
  }
}
