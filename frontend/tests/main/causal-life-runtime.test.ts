import { expect, it } from 'vitest';
import { scenario } from './autonomy-scenario-fixture';
import { CausalLifeRecorder } from '../../src/application/services/causal-life-recorder';
import type { CausalLifeEpisode } from '../../src/application/ports/causal-life.interface';
import type { ActivityOutcomeFeedback } from '../../src/application/ports/shimeji-feedback-port';

it('binds actual cursor-game cancellation to accepted drag before the terminal and never replays its experience', () => {
  const observed: CausalLifeEpisode[] = [];
  const recorder = new CausalLifeRecorder({ appRunId: () => 'app', generation: () => 0, context: () => null,
    toTimestamp: at => new Date(at).toISOString(), onFailure: () => {}, onObserved: e => observed.push(e) });
  const f = scenario({}, .999, undefined, undefined, { onActivityOutcome: e => recorder.outcome(e) });
  const sample = () => f.main.handleCursorObservation({ x: 440, y: 790 });
  sample(); for (let i = 0; i < 5; i++) { f.advance(100); sample(); }
  f.setRandom(0); f.advance(100); expect(sample()).toBe(true);
  const run = f.main.getActivityTimeline()!.runId;
  for (let i = 0; i < 12; i++) { sample(); f.advance(100); }
  recorder.beginInput(false, f.now()); f.main.beginDrag(); recorder.endInput();
  expect(observed).toHaveLength(1);
  expect(observed[0]).toMatchObject({ activityRunId: run, outcome: 'cancelled', terminalReason: 'user_interaction', cause: 'user_interrupted', source: 'user', triggerSequence: 1, sequence: 2, executedMs: 1200 });
  f.main.notifyVoluntaryMovementCompleted(); f.main.dispose(); expect(observed).toHaveLength(1);
});

it('preview/rejected local activity is not a causal episode and unrelated cancellation does not blame the user', () => {
  const observed: CausalLifeEpisode[] = [];
  const recorder = new CausalLifeRecorder({ appRunId: () => 'app', generation: () => 0, context: () => null,
    toTimestamp: at => new Date(at).toISOString(), onFailure: () => {}, onObserved: e => observed.push(e) });
  const f = scenario({}, .999, undefined, undefined, { onActivityOutcome: e => recorder.outcome(e) });
  f.setMovable(false); expect(f.main.handleCharacterInteraction('play')).toBe(false);
  expect(observed).toHaveLength(0); f.main.dispose();
});

it.each([false, true])('records the first cursor outcome after composition recreation (memory reset: %s)', reset => {
  let generation = 0, appRunId = 'app-1', activitySequence = 0;
  const observed: CausalLifeEpisode[] = [];
  const recorder = new CausalLifeRecorder({ appRunId: () => appRunId, generation: () => generation, context: () => null,
    toTimestamp: at => new Date(at).toISOString(), onFailure: () => {}, onObserved: episode => observed.push(episode) });
  const hooks = { createActivitySequence: () => ++activitySequence, onActivityOutcome: (event: ActivityOutcomeFeedback) => recorder.outcome(event) };
  const run = () => {
    const f = scenario({}, .999, undefined, undefined, hooks);
    const sample = () => f.main.handleCursorObservation({ x: 440, y: 790 });
    sample(); for (let i = 0; i < 5; i++) { f.advance(100); sample(); }
    f.setRandom(0); f.advance(100); expect(sample()).toBe(true);
    for (let i = 0; i < 12; i++) { sample(); f.advance(100); }
    recorder.beginInput(false, f.now()); f.main.beginDrag(); recorder.endInput(); f.main.dispose();
    return f.outcomes[0]!;
  };
  const first = run(); expect(observed).toHaveLength(1);
  if (reset) { generation++; appRunId = 'app-2'; recorder.reset(); }
  run();
  expect(observed).toHaveLength(2);
  expect(observed[1]).toMatchObject({ appRunId, cause: 'user_interrupted', executedMs: 1200 });
  expect(observed[1]?.activityRunId).not.toBe(observed[0]?.activityRunId);
  recorder.outcome(first); expect(observed).toHaveLength(2);
});
