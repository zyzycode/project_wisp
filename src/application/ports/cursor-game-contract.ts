/** Normalized Application boundary; no provider, renderer or OS data. */
export type CursorGameOutcome = 'caught' | 'missed' | 'lost_target' | 'cancelled';

export interface CursorGameResult {
  readonly activityRunId: string;
  readonly atMs: number;
  readonly outcome: CursorGameOutcome;
  readonly playCompleted: boolean;
  readonly executedMs: number;
}

/** Values are injected into pure Domain logic, which does not import Application. */
export interface CursorGameTuning {
  readonly version: 'cursor-game-v1';
  readonly maxEpisodeMs: number;
  readonly maxTravelDip: number;
  readonly retargetIntervalMs: number;
  readonly maxTargets: number;
  readonly minTargetShiftDip: number;
  readonly attemptMs: number;
  readonly reactionMs: number;
  readonly settleMs: number;
}

export const DEFAULT_CURSOR_GAME_TUNING: CursorGameTuning = {
  version: 'cursor-game-v1',
  maxEpisodeMs: 6_000,
  maxTravelDip: 160,
  retargetIntervalMs: 500,
  maxTargets: 4,
  minTargetShiftDip: 20,
  attemptMs: 1_000,
  reactionMs: 600,
  settleMs: 600,
};
