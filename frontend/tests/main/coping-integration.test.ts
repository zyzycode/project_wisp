import { expect, it } from 'vitest';
import { scenario } from './autonomy-scenario-fixture';
import { CopingRuntime } from '../../src/application/services/coping-runtime';
import { CausalLifeRecorder } from '../../src/application/services/causal-life-recorder';
import type { CausalLifeEpisode } from '../../src/application/ports/causal-life.interface';

function fixture() {
  let runtime: CopingRuntime | null = null;
  let recorder: CausalLifeRecorder | null = null;
  const f = scenario({ play: 0, boredom: 0, attention: 0 }, .999, undefined, undefined, {
    coping: {
      consider: gates => runtime?.consider(gates) ?? null,
      selected: (kind, applied) => runtime?.selected(kind, applied),
      activityCommitted: (runId, activityId) => runtime?.activityCommitted(runId, activityId),
      terminal: (runId, completed) => runtime?.terminal(runId, completed),
      cancel: () => runtime?.cancel(),
    },
    onActivityOutcome: event => recorder?.outcome(event),
  });
  runtime = new CopingRuntime({ character: f.character, now: f.now, appRunId: () => 'app', interpretation: () => null });
  recorder = new CausalLifeRecorder({ appRunId: () => 'app', generation: () => 0, context: () => null,
    toTimestamp: at => new Date(at).toISOString(), onFailure: () => {},
    onObserved: (episode, at) => { f.character.observeCausalEpisode(episode, at); runtime?.observed(episode, at); } });
  const observe = () => {
    const episode: CausalLifeEpisode = { appRunId: 'app', sequence: 2, revision: 1, occurredAt: new Date(f.now()).toISOString(),
      source: 'user', triggerSequence: 1, activityRunId: 'game', activity: 'cursor_game', outcome: 'cancelled',
      terminalReason: 'user_interaction', cause: 'user_interrupted', executedMs: 1200, participation: 'user_engaged' };
    f.character.observeCausalEpisode(episode, f.now()); runtime?.observed(episode, f.now());
  };
  const select = () => { f.setRandom(0); for (let i = 0; i < 10 && !f.main.getActivityTimeline(); i++) f.pulse(); };
  const game = () => {
    const sample = () => f.main.handleCursorObservation({ x: 440, y: 790 });
    sample(); for (let i = 0; i < 5; i++) { f.advance(100); sample(); }
    f.setRandom(0); f.advance(100); expect(sample()).toBe(true);
    for (let i = 0; i < 12; i++) { sample(); f.advance(100); }
  };
  return { ...f, observe, select, recorder, game };
}

it('the same accepted click creates an opportunity that reaches the existing local calm and relieves only on completion', () => {
  const f = fixture();
  f.game();
  f.recorder.beginInput(true, f.now()); f.main.handleClick(); f.recorder.endInput();
  expect(f.character.getCausalEmotion()?.kind).toBe('irritated');
  f.select();
  expect(f.main.getActivityTimeline()?.activityId).toBe('calm');
  expect(f.main.getDecisionTrace().at(-1)?.selection?.find(row => row.selected)?.copingMultiplier).toBe(1.2);
  const before = f.character.getCausalEmotion()!.intensity;
  f.finish();
  expect(f.character.getCausalEmotion()!.intensity).toBeLessThan(before * .6);
  f.main.dispose();
});

it.each([false, true])('accepted semantic drag cancels its own newly caused window (external motion event: %s)', externalEvent => {
  const f = fixture(); f.game();
  f.recorder.beginInput(true, f.now()); f.main.beginDrag(); f.recorder.endInput();
  if (externalEvent) f.main.handleMotionEvent({ type: 'drag_started', atMs: f.now() });
  expect(f.character.getCausalEmotion()?.kind).toBe('irritated');
  f.main.handleMotionEvent({ type: 'landed', outcome: 'soft_landing', impactSeverity: 0 }); f.select();
  expect(f.main.getDecisionTrace().at(-1)?.selection?.every(row => row.copingMultiplier === 1)).toBe(true);
  f.main.dispose();
});

it('completion does not relieve an affect replaced after boosted admission', () => {
  const f = fixture(); f.observe(); f.select();
  f.character.observeCausalEpisode({ sequence: 3, source: 'user', triggerSequence: null, activityRunId: null,
    activity: null, outcome: null, cause: 'contact', executedMs: 0, participation: 'none' }, f.now());
  f.finish();
  expect(f.character.getCausalEmotion()).toMatchObject({ causeSequence: 3, kind: 'curious' });
  expect(f.character.getCausalEmotion()!.intensity).toBeGreaterThan(.08);
  f.main.dispose();
});

it.each(['quiet', 'support', 'user', 'dispose'] as const)('cancels pending coping on %s without leaking its factor to a later local choice', action => {
  const f = fixture(); f.observe();
  if (action === 'quiet') { f.main.setQuietMode(true); f.main.setQuietMode(false); }
  if (action === 'support') f.main.handleSupportLost();
  if (action === 'user') f.main.suspendForUserInteraction();
  if (action === 'dispose') f.main.dispose();
  if (action === 'user') f.main.resumeAfterUserInteraction();
  if (action === 'support') f.main.handleMotionEvent({ type: 'landed', outcome: 'soft_landing', impactSeverity: 0 });
  if (action !== 'dispose') {
    f.select();
    expect(f.main.getDecisionTrace().at(-1)?.selection?.every(row => row.copingMultiplier === 1)).toBe(true);
  }
  f.main.dispose();
});

it('menu pause preserves the original TTL', () => {
  const f = fixture(); f.observe(); f.main.setMenuOpen(true); f.elapse(30000); f.main.setMenuOpen(false); f.select();
  expect(f.main.getDecisionTrace().at(-1)?.selection?.every(row => row.copingMultiplier === 1)).toBe(true);
  f.main.dispose();
});

it('quiet cancellation after actual admission prevents relief even if the calm run completes', () => {
  const f = fixture(); f.observe(); f.select();
  expect(f.main.getDecisionTrace().at(-1)?.selection?.find(row => row.selected)?.copingMultiplier).toBe(1.2);
  const before = f.character.getCausalEmotion()!.intensity;
  f.main.setQuietMode(true); f.finish();
  expect(f.character.getCausalEmotion()!.intensity).toBeGreaterThan(before * .8);
  f.main.dispose();
});
