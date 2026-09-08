import { describe, expect, it } from 'vitest';
import { advanceCursorGame, initialCursorGame, type GameObservation, type GameState } from '../../src/domain/behavior/cursor-game';
import type { ActivityRuntimeState } from '../../src/domain/behavior/activity-runner';
import { DEFAULT_CURSOR_GAME_TUNING as tuning } from '../../src/application/ports/cursor-game-contract';

const bounds = { id: 'screen', x: -500, y: 0, width: 1500, height: 800 };
function observation(now = 0, x = 400, rootX = 400): GameObservation {
  return { root: { x: rootX, y: 790 }, cursor: { globalPosition: { x, y: 790 }, capturedAtMs: now }, dwellMs: 500,
    collisionInsets: { left: 10, right: 10, top: 80, bottom: 10 },
    environment: { capturedAtMs: now, screenBounds: bounds,
      currentSurface: { id: 'floor', kind: 'screen_floor', bounds, isValidSupport: true } } };
}
function runtime(phase = 'notice', start = 0, end = 600): ActivityRuntimeState {
  return { runId: 'run', activityId: 'cursor_interest', currentStepId: phase, stage: 'looping', status: 'running',
    startedAtMs: 0, stepStartedAtMs: start, phaseEndsAtMs: end };
}
const initial = () => initialCursorGame(observation());
describe('cursor game semantic timeline', () => {
  it('attempts while standing, catches at the checkpoint and finishes reaction/settle', () => {
    const attempt = advanceCursorGame(initial(), runtime(), observation(600), tuning, 600);
    expect(attempt.update.emittedStep).toMatchObject({ id: 'attempt', intent: { kind: 'cursor_play' } });
    const caught = advanceCursorGame(attempt.game, attempt.update.runtime!, observation(1600), tuning, 1600);
    expect(caught.game).toMatchObject({ outcome: 'caught', playCompleted: true, targets: 0 });
    expect(caught.update.emittedStep).toMatchObject({ intent: { kind: 'happy_reaction' } });
    const settle = advanceCursorGame(caught.game, caught.update.runtime!, observation(2200, 700), tuning, 2200);
    const end = advanceCursorGame(settle.game, settle.update.runtime!, observation(2800), tuning, 2800);
    expect(end.update.result?.status).toBe('completed'); expect(end.game.outcome).toBe('caught');
  });
  it('misses a fresh reachable cursor outside the radius at the checkpoint', () => {
    const result = advanceCursorGame(initial(), runtime('attempt', 600, 1600), observation(1600, 500), tuning, 1600);
    expect(result.game).toMatchObject({ outcome: 'missed', playCompleted: true });
  });
  it('keeps TTL inclusive and gives loss priority immediately after it', () => {
    expect(advanceCursorGame(initial(), runtime('attempt', 0, 300), observation(0), tuning, 300).game.outcome).toBe('caught');
    expect(advanceCursorGame(initial(), runtime('attempt', 0, 301), observation(0), tuning, 301).game)
      .toMatchObject({ outcome: 'lost_target', playCompleted: false });
  });
  it('gives the episode deadline priority over a simultaneous catch and terminates delayed ticks', () => {
    for (const now of [6000, 9000]) {
      const result = advanceCursorGame(initial(), runtime('attempt', 5000, 6000), observation(now), tuning, now);
      expect(result.game).toMatchObject({ outcome: 'missed', playCompleted: false });
      expect(result.update.result?.status).toBe('completed');
    }
  });
  it('does not retarget an active leg and accounts for reversed voluntary travel', () => {
    const leg = advanceCursorGame(initial(), runtime(), observation(600, 520), tuning, 600);
    expect(leg.update.emittedStep).toMatchObject({ id: 'approach_1', targetRootPosition: { x: 520 } });
    const active = advanceCursorGame(leg.game, leg.update.runtime!, observation(800, 200, 450), tuning, 800);
    expect(active.update.emittedStep).toBeUndefined(); expect(active.game.travel).toBe(50);
    const arrived = advanceCursorGame(active.game, leg.update.runtime!, observation(1200, 200, 520), tuning, 1200, true);
    expect(arrived.game.travel).toBe(120);
    expect(arrived.update.emittedStep).toMatchObject({ targetRootPosition: { x: 480 } });
    const exhausted = advanceCursorGame(arrived.game, arrived.update.runtime!, observation(1500, 200, 480), tuning, 1500, true);
    expect(exhausted.game).toMatchObject({ outcome: 'missed', travel: 160, playCompleted: false });
  });
  it('waits for the retarget interval, limits targets, and reserves the full phase tail', () => {
    const state: GameState = { ...initial(), targets: 1, lastTarget: 900, lastTargetAtMs: 800 };
    const wait = advanceCursorGame(state, runtime('approach_1', 800, 3800), observation(1000, 600), tuning, 1000, true);
    expect(wait.update.emittedStep?.type).toBe('delay');
    const leg = advanceCursorGame(wait.game, wait.update.runtime!, observation(1300, 600), tuning, 1300);
    expect(leg.update.emittedStep).toMatchObject({ id: 'approach_2', timeoutMs: 2500 });
    const cap = advanceCursorGame({ ...state, targets: 4 }, runtime('wait', 1200, 1300), observation(1300, 600), tuning, 1300);
    expect(cap.game.outcome).toBe('missed');
    const noTime = advanceCursorGame(initial(), runtime('wait', 3700, 3800), observation(3800, 600), tuning, 3800);
    expect(noTime.game.outcome).toBe('missed');
  });
  it('does not charge support translation and stops on support identity loss', () => {
    const windowInput = (x: number, rootX: number): GameObservation => ({ ...observation(1000, 600, rootX),
      root: { x: rootX, y: 600 }, cursor: { capturedAtMs: 1000, globalPosition: { x: 600, y: 600 } },
      environment: { capturedAtMs: 1000, screenBounds: bounds, currentSurface: { id: 'window', kind: 'window_top',
        bounds: { x, y: 600, width: 700, height: 100 }, isValidSupport: true } } });
    const start = initialCursorGame(windowInput(0, 400));
    const moved = advanceCursorGame(start, runtime('approach_1', 600, 3800), windowInput(50, 450), tuning, 1000);
    expect(moved.game.travel).toBe(0);
    const lost = advanceCursorGame(moved.game, runtime('approach_1', 600, 3800), observation(1100), tuning, 1100);
    expect(lost.game.outcome).toBe('lost_target'); expect(lost.update.result?.status).toBe('completed');
  });
  it.each([null, { capturedAtMs: 600, globalPosition: { x: 900, y: 790 } },
    { capturedAtMs: 600, globalPosition: { x: 400, y: 500 } }])('loses missing, out-of-area and unreachable targets', cursor => {
    const result = advanceCursorGame(initial(), runtime(), { ...observation(600), cursor }, tuning, 600);
    expect(result.game).toMatchObject({ outcome: 'lost_target', playCompleted: false });
    expect(result.stopMotion).toBe(true);
  });
});
