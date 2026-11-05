import { expect, it } from 'vitest';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { CausalLifeRecorder } from '../../src/application/services/causal-life-recorder';
import type { CausalObservedEvent } from '../../src/domain/character/causal-affect';
import type { ActivityOutcomeFeedback } from '../../src/application/ports/shimeji-feedback-port';

const terminal: CausalObservedEvent = { sequence: 1, source: 'system', triggerSequence: null, activityRunId: 'run',
  activity: 'cursor_game', outcome: 'cancelled', cause: 'other', executedMs: 30_000, participation: 'solitary' };

it('temporarily satiates from actual execution once, preserving preferences and reset/restart neutrality', () => {
  let now = 0;
  const service = new CharacterStateService({ now: () => 0, monotonicNow: () => now });
  const before = service.getState();
  service.observeCausalEpisode(terminal, now);
  expect(service.getCursorGameSatiation()).toBe(.5);
  service.observeCausalEpisode(terminal, now);
  expect(service.getCursorGameSatiation()).toBe(.5);
  expect(service.getState()).toEqual(before);
  now = 60_000; service.tickNeeds(60_000);
  expect(service.getCursorGameSatiation()).toBeCloseTo(.3);
  expect(service.getState().preferences).toEqual(before.preferences);
  const checkpoint = service.getState();
  service.replaceRestoredState(checkpoint); expect(service.getCursorGameSatiation()).toBe(0);
  service.observeCausalEpisode(terminal, now); service.resetToDefaults(); expect(service.getCursorGameSatiation()).toBe(0);
  expect(new CharacterStateService({ initialState: checkpoint }).getCursorGameSatiation()).toBe(0);
});

it('habituates only non-interrupting contacts and never normalizes a short or repeated interruption', () => {
  let now = 0;
  const service = new CharacterStateService({ now: () => 0, monotonicNow: () => now });
  const recorder = new CausalLifeRecorder({ appRunId: () => 'app', context: () => null, generation: () => 0,
    toTimestamp: at => new Date(at).toISOString(), onFailure: () => {},
    onObserved: (episode, at) => service.observeCausalEpisode(episode, at) });
  const touch = () => { recorder.beginInput(true, now); recorder.endInput(); };
  touch(); expect(service.getCausalEmotion()?.intensity).toBe(.1);
  const outcome: ActivityOutcomeFeedback = { type: 'activity_outcome', eventId: 'run:terminal', activityRunId: 'run', activitySequence: 1,
    activity: 'cursor_game', terminalReason: 'user_interaction', atMs: 100, family: 'cursor_interest', outcome: 'cancelled',
    participation: 'user_engaged', executedMs: 100, playCompleted: false };
  now = 100; recorder.beginInput(true, now); recorder.outcome(outcome); recorder.endInput();
  now = 200; touch(); expect(service.getCausalEmotion()?.intensity).toBe(.05);
  now = 300; recorder.beginInput(true, now); recorder.outcome({ ...outcome, activitySequence: 2, activityRunId: 'second', atMs: now, executedMs: 1_500 }); recorder.endInput();
  expect(service.getCausalEmotion()).toMatchObject({ kind: 'irritated', intensity: .2 });
  now = 400; recorder.beginInput(true, now); recorder.outcome({ ...outcome, activitySequence: 3, activityRunId: 'third', atMs: now, executedMs: 1_500 }); recorder.endInput();
  expect(service.getCausalEmotion()?.kind).toBe('irritated');
  expect(service.getCausalEmotion()?.intensity).toBeCloseTo(.3);
  now = 30_000; service.tickNeeds(29_600); touch(); expect(service.getCausalEmotion()?.intensity).toBe(.05);
});
