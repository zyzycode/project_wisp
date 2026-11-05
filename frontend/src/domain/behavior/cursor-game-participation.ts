import { cursorGameReachable, type GameObservation, type GameState, type GameTuning } from './cursor-game';
import type { Vector2Dto } from './motion-engine';

export interface CursorGameParticipation {
  readonly anchor: { readonly position: Vector2Dto; readonly capturedAtMs: number } | null;
  readonly highWater: number | null;
  readonly lastEvaluatedAtMs: number | null;
  readonly engaged: boolean;
}
export function initialCursorGameParticipation(nowMs: number): CursorGameParticipation {
  return { anchor: null, highWater: null, lastEvaluatedAtMs: Number.isFinite(nowMs) ? nowMs : null, engaged: false };
}

/** Observed absolute cursor movement, never inferred attention, intent or enjoyment. */
export function observeCursorGameParticipation(state: CursorGameParticipation, startedAtMs: number,
  game: Pick<GameState, 'outcome' | 'supportId' | 'supportKind'>, input: GameObservation,
  tuning: Pick<GameTuning, 'minTargetShiftDip'>, nowMs: number): CursorGameParticipation {
  if (!Number.isFinite(nowMs) || nowMs < 0 || (state.lastEvaluatedAtMs !== null && nowMs < state.lastEvaluatedAtMs)) {
    return initialCursorGameParticipation(nowMs);
  }
  const current = { ...state, lastEvaluatedAtMs: nowMs };
  if (game.outcome !== null || state.engaged) return current;
  const cursor = input.cursor, support = input.environment.currentSurface;
  if (!Number.isFinite(startedAtMs) || !cursor || !Number.isFinite(cursor.capturedAtMs)
    || cursor.capturedAtMs <= startedAtMs || support?.id !== game.supportId || support.kind !== game.supportKind
    || !cursorGameReachable(input, nowMs)) return { ...current, anchor: null };
  if (state.highWater !== null && cursor.capturedAtMs <= state.highWater) return current;
  const next = { ...current, highWater: cursor.capturedAtMs };
  const anchor = state.anchor;
  if (!anchor || cursor.capturedAtMs - anchor.capturedAtMs > 2000) {
    return { ...next, anchor: { position: { ...cursor.globalPosition }, capturedAtMs: cursor.capturedAtMs } };
  }
  if (cursor.capturedAtMs - anchor.capturedAtMs < 100) return next;
  if (Math.hypot(cursor.globalPosition.x - anchor.position.x, cursor.globalPosition.y - anchor.position.y) >= tuning.minTargetShiftDip) {
    return { ...next, anchor: null, engaged: true };
  }
  return next;
}

/** Terminal reads no new observation and cannot turn a late input into participation. */
export function terminalCursorGameParticipation(state: CursorGameParticipation, nowMs: number): 'user_engaged' | 'solitary' {
  return state.engaged && Number.isFinite(nowMs) && nowMs >= 0
    && state.lastEvaluatedAtMs !== null && nowMs >= state.lastEvaluatedAtMs ? 'user_engaged' : 'solitary';
}
