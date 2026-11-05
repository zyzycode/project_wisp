import { expect, it } from 'vitest';
import { scenario } from './autonomy-scenario-fixture';
import { CausalLifeRecorder } from '../../src/application/services/causal-life-recorder';
import type { CausalLifeEpisode } from '../../src/application/ports/causal-life.interface';

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
