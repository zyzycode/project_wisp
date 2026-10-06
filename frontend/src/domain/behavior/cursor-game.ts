import type { ActivityRuntimeState, ActivityRunnerUpdate, ActivityStep } from './activity-runner';
import { calculateRootCollisionRange, type CollisionInsets, type Vector2Dto } from './motion-engine';
import type { EnvironmentSnapshot } from './surface-kinematics';
import { DEFAULT_CURSOR_REACTION_CONSTRAINTS } from './gaze-engine';
import { DEFAULT_CURSOR_OBSERVE_CONSTRAINTS } from './cursor-observe-policy';

export type GameOutcome = 'caught' | 'missed' | 'lost_target' | 'cancelled';
export interface GameTuning {
  readonly maxEpisodeMs: number; readonly maxTravelDip: number; readonly retargetIntervalMs: number;
  readonly maxTargets: number; readonly minTargetShiftDip: number; readonly attemptMs: number;
  readonly reactionMs: number; readonly settleMs: number;
}
export interface GameObservation {
  readonly root: Vector2Dto; readonly environment: EnvironmentSnapshot; readonly collisionInsets: CollisionInsets;
  readonly cursor: { readonly globalPosition: Vector2Dto; readonly capturedAtMs: number } | null;
  readonly dwellMs: number;
}
export interface GameState {
  readonly supportId: string; readonly supportKind: string; readonly localX: number;
  readonly travel: number; readonly targets: number; readonly lastTarget: number | null;
  readonly lastTargetAtMs: number; readonly outcome: GameOutcome | null; readonly playCompleted: boolean;
}
export interface GameUpdate { readonly game: GameState; readonly update: ActivityRunnerUpdate; readonly stopMotion?: boolean }

function geometry(input: GameObservation) {
  const surface = input.environment.currentSurface;
  if (!surface?.isValidSupport || !['screen_floor', 'window_top'].includes(surface.kind)) return null;
  let range;
  try { range = calculateRootCollisionRange(input.environment.screenBounds, input.collisionInsets); } catch { return null; }
  const minX = Math.max(range.minX, surface.bounds.x + input.collisionInsets.left);
  const maxX = Math.min(range.maxX, surface.bounds.x + surface.bounds.width - input.collisionInsets.right);
  const y = surface.kind === 'screen_floor' ? range.maxY : surface.supportY ?? surface.bounds.y;
  if (minX >= maxX || input.root.x < minX || input.root.x > maxX || Math.abs(input.root.y - y) > 2) return null;
  return { surface, minX, maxX, y, localX: input.root.x - surface.bounds.x };
}
export function cursorGameReachable(input: GameObservation, nowMs: number): boolean {
  const g = geometry(input), c = input.cursor;
  if (!g || !c) return false;
  const age = nowMs - c.capturedAtMs;
  return [c.globalPosition.x, c.globalPosition.y, input.root.x, input.root.y].every(Number.isFinite)
    && age >= 0 && age <= DEFAULT_CURSOR_REACTION_CONSTRAINTS.signalMaxAgeMs
    && Math.abs(c.globalPosition.y - input.root.y) <= 160
    && Math.hypot(c.globalPosition.x - input.root.x, c.globalPosition.y - input.root.y)
      <= DEFAULT_CURSOR_OBSERVE_CONSTRAINTS.ambientRadiusWorldPx;
}
export function initialCursorGame(input: GameObservation): GameState {
  const surface = input.environment.currentSurface;
  return { supportId: surface?.id ?? '', supportKind: surface?.kind ?? '',
    localX: input.root.x - (surface?.bounds.x ?? 0), travel: 0, targets: 0, lastTarget: null,
    lastTargetAtMs: -Infinity, outcome: null, playCompleted: false };
}

/** Extends the current Activity timeline; no timers, Motion commands or second run. */
export function advanceCursorGame(game: GameState, runtime: ActivityRuntimeState, input: GameObservation,
  tuning: GameTuning, nowMs: number, arrived = false): GameUpdate {
  const g = geometry(input);
  const sameSupport = g !== null && g.surface.id === game.supportId && g.surface.kind === game.supportKind;
  const localX = g?.localX ?? game.localX;
  const next: GameState = { ...game, localX,
    travel: game.travel + (runtime.currentStepId.startsWith('approach') && sameSupport ? Math.abs(localX - game.localX) : 0) };
  const reachable = sameSupport && cursorGameReachable(input, nowMs);
  const deadline = runtime.startedAtMs + tuning.maxEpisodeMs;
  const terminal = (state: GameState): GameUpdate => ({ game: state, stopMotion: true,
    update: { result: { status: 'completed', activityId: runtime.activityId, completedAtMs: nowMs }, clearedRunId: runtime.runId } });
  const emit = (state: GameState, step: ActivityStep, stopMotion = false): GameUpdate => {
    const duration = step.type === 'animation' ? step.completion.durationMs : step.type === 'locomotion' ? step.timeoutMs
      : step.type === 'delay' ? step.durationMs : 0;
    return { game: state, stopMotion, update: { emittedStep: step, runtime: { ...runtime, currentStepId: step.id,
      stage: step.stage, stepStartedAtMs: nowMs, phaseEndsAtMs: Math.min(deadline, nowMs + duration) } } };
  };
  const react = (outcome: Exclude<GameOutcome, 'cancelled'>): GameUpdate => {
    const state = { ...next, outcome };
    if (!sameSupport || nowMs >= deadline) return terminal(state);
    return emit(state, { id: 'reaction', actionId: `cursor_${outcome}`, type: 'animation', stage: 'exiting',
      intent: { kind: outcome === 'caught' ? 'happy_reaction' : 'confused_reaction' },
      completion: { type: 'elapsed', durationMs: tuning.reactionMs } }, true);
  };
  // Deadline and loss precede a checkpoint, including delayed ticks.
  if (nowMs >= deadline) return terminal({ ...next, outcome: next.outcome ?? (reachable ? 'missed' : 'lost_target') });
  if (next.outcome === null && !reachable) return react('lost_target');
  if (next.outcome !== null && !sameSupport) return terminal(next);
  const due = runtime.phaseEndsAtMs !== null && nowMs >= runtime.phaseEndsAtMs;
  const phase = runtime.currentStepId;
  if (phase === 'reaction' && due) return emit(next, { id: 'settle', actionId: 'cursor_settle', type: 'animation',
    stage: 'exiting', intent: { kind: 'settle' }, completion: { type: 'elapsed', durationMs: tuning.settleMs } });
  if (phase === 'settle' && due) return terminal(next);
  if (next.outcome !== null) return { game: next, update: { runtime } };
  const within = input.cursor !== null && Math.hypot(input.cursor.globalPosition.x - input.root.x,
    input.cursor.globalPosition.y - input.root.y) <= DEFAULT_CURSOR_REACTION_CONSTRAINTS.swatRadiusWorldPx;
  if (phase === 'attempt' && due) {
    const result = react(within ? 'caught' : 'missed');
    return { ...result, game: { ...result.game, playCompleted: true } };
  }
  if (phase === 'attempt') return { game: next, update: { runtime } };
  if (phase.startsWith('approach') && !arrived) {
    if (due || next.travel >= tuning.maxTravelDip) return react('missed');
    return { game: next, update: { runtime } };
  }
  if (!arrived && !due) return { game: next, update: { runtime } };
  const tail = tuning.attemptMs + tuning.reactionMs + tuning.settleMs;
  if (within && input.dwellMs >= DEFAULT_CURSOR_REACTION_CONSTRAINTS.swatDwellMs && deadline - nowMs >= tail) {
    return emit(next, { id: 'attempt', actionId: 'cursor_play', type: 'animation', stage: 'looping',
      intent: { kind: 'cursor_play', expressionHint: 'happy' }, completion: { type: 'elapsed', durationMs: tuning.attemptMs } });
  }
  if (deadline - nowMs <= tail || next.targets >= tuning.maxTargets || next.travel >= tuning.maxTravelDip) return react('missed');
  const remaining = tuning.maxTravelDip - next.travel;
  const x = Math.max(g!.minX, Math.min(g!.maxX, input.root.x + Math.max(-remaining,
    Math.min(remaining, input.cursor!.globalPosition.x - input.root.x))));
  const target = x - g!.surface.bounds.x;
  const shift = next.lastTarget === null ? Infinity : Math.abs(target - next.lastTarget);
  if (nowMs - next.lastTargetAtMs < tuning.retargetIntervalMs || shift < tuning.minTargetShiftDip || Math.abs(x - input.root.x) < 1) {
    return emit(next, { id: 'wait', actionId: 'cursor_wait', type: 'delay', stage: 'looping',
      durationMs: Math.min(100, deadline - nowMs - tail) });
  }
  return emit({ ...next, targets: next.targets + 1, lastTarget: target, lastTargetAtMs: nowMs }, {
    id: `approach_${next.targets + 1}`, actionId: 'cursor_approach', type: 'locomotion', stage: 'looping', gait: 'walk',
    targetRef: g!.surface.id, targetRootPosition: { x, y: g!.y },
    ...(g!.surface.kind === 'window_top' ? { supportLocalDistancePx: target } : {}),
    timeoutMs: deadline - nowMs - tail, intent: { kind: 'walk' },
  });
}
