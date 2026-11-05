import { expect, it, vi } from 'vitest';
import { BrainActivityRuntime } from '../../src/application/services/brain-activity-runtime';
import { CausalLifeRecorder } from '../../src/application/services/causal-life-recorder';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { selectLocalActivity } from '../../src/domain/behavior/local-activity-policy';
import { createCharacterAutonomySnapshot } from '../../src/domain/character/autonomy-character-engine';
import { hasBookSupport } from '../../src/domain/behavior/book-activity';
import type { CausalLifeEpisode } from '../../src/application/ports/causal-life.interface';
import type { ActivityOutcomeFeedback } from '../../src/application/ports/shimeji-feedback-port';
import type { AnimationIntent, AnimationIntentKind } from '../../src/domain/animation/animation-intent';

const book = { kind: 'book', source: 'timer', priority: 'normal', reason: 'local_utility' } as const;
function fixture() {
  let now = 0, rawId = 0, supported = true, allowed = true;
  const bounds = { id: 'screen', x: 0, y: 0, width: 1000, height: 800 };
  const insets = { left: 50, right: 50, top: 90, bottom: 10 }, root = { x: 500, y: 790 };
  const character = new CharacterStateService({ now: () => now, monotonicNow: () => now });
  const state = character.getState(); state.needs = { energy: 60, boredom: 100, comfort: 20, attention: 0, play: 0 }; character.replaceRestoredState(state);
  const observed: CausalLifeEpisode[] = [], outcomes: ActivityOutcomeFeedback[] = [], visuals: AnimationIntent<AnimationIntentKind>[] = [];
  const recorder = new CausalLifeRecorder({ appRunId: () => 'app', context: () => null, generation: () => 0,
    toTimestamp: at => new Date(at).toISOString(), onFailure: vi.fn(), onObserved: (event, at) => { observed.push(event); character.observeCausalEpisode(event, at); } });
  const environment = () => ({ capturedAtMs: now, screenBounds: bounds,
    currentSurface: { id: 'floor', kind: 'screen_floor' as const, bounds, isValidSupport: supported } });
  const runtime = new BrainActivityRuntime({ clock: { now: () => now }, canBook: () => allowed,
    getCharacterSnapshot: () => createCharacterAutonomySnapshot(character.getState()),
    getSelectionContext: () => ({ character: character.getSnapshot(), synthesizedTone: 'neutral', environment: environment() }),
    getRootPosition: () => root, getCollisionInsets: () => insets, nextRandom: () => .5,
    requestLocomotion: () => true, cancelLocomotion: () => true, createRunId: () => `run-${++rawId}`,
    onVisualIntent: intent => visuals.push(intent), onTerminated: vi.fn(),
    onOutcome: event => { outcomes.push(event); recorder.outcome(event); } });
  return { runtime, recorder, character, observed, outcomes, visuals, environment, root, insets,
    at: (at: number) => { now = at; runtime.tick(now); },
    setSupported: () => { supported = false; }, setAllowed: () => { allowed = false; } };
}
it('runs three actual elapsed phases offline, rewards only a real terminal once and applies terminal cooldown', () => {
  const f = fixture(); expect(f.runtime.start(book)).toBe(true);
  expect(f.visuals.at(-1)).toMatchObject({ kind: 'book_settle', propHint: 'none' });
  f.at(1199); expect(f.runtime.getRuntime()?.currentStepId).toBe('settle');
  f.at(1200); expect(f.visuals.at(-1)).toMatchObject({ kind: 'book_with_book', propHint: 'book' });
  f.at(13_199); expect(f.outcomes).toHaveLength(0);
  f.at(13_200); expect(f.visuals.at(-1)).toMatchObject({ kind: 'book_finish', propHint: 'none' });
  f.at(14_000); expect(f.runtime.getRuntime()).toBeNull();
  expect(f.outcomes).toHaveLength(1);
  expect(f.observed[0]).toMatchObject({ activity: 'book', participation: 'solitary', source: 'autonomy', cause: 'completed', executedMs: 14_000 });
  expect(f.character.getState().needs).toMatchObject({ energy: 59, boredom: 96, play: 0 });
  expect(f.character.getCausalEmotion()).toMatchObject({ activity: 'book', kind: 'content', intensity: .1, target: 'self' });
  expect(f.character.getBookSatiation()).toBeCloseTo(14_000 / 60_000);
  f.recorder.outcome(f.outcomes[0]!); f.at(15_000);
  expect(f.observed).toHaveLength(1); expect(f.character.getState().needs.energy).toBe(59);
  expect(f.runtime.start(book)).toBe(false); f.at(44_000); expect(f.runtime.start(book)).toBe(true);
});
it('times out before runner transitions at the exact absolute deadline, including a stalled finish', () => {
  const f = fixture(); f.runtime.start(book); f.at(1200); f.at(15_200);
  expect(f.runtime.getRuntime()?.currentStepId).toBe('finish'); f.at(16_000);
  expect(f.observed[0]).toMatchObject({ outcome: 'cancelled', cause: 'timeout', source: 'system', executedMs: 16_000 });
  expect(f.character.getState().needs.energy).toBe(60);
  expect(f.visuals.at(-1)?.propHint).toBe('none');
});
it('records one bounded timeout after a long scheduler stall without rewarding a completed book', () => {
  const f = fixture(); f.runtime.start(book); f.at(1200); f.at(700000); f.at(700001);
  expect(f.outcomes).toHaveLength(1); expect(f.observed).toHaveLength(1);
  expect(f.observed[0]).toMatchObject({ outcome: 'cancelled', cause: 'timeout', executedMs: 600000 });
  expect(f.character.getState().needs.energy).toBe(60);
  expect(f.visuals.at(-1)?.propHint).toBe('none');
});
it('distinguishes accepted drag from raw physics, cancels synchronously and never replays an old phase', () => {
  for (const acceptedDrag of [false, true]) {
    const f = fixture(); f.runtime.start(book); f.at(1200);
    f.recorder.beginInput(false, 1200, acceptedDrag);
    f.runtime.cancel('forced_motion', true); f.recorder.endInput();
    expect(f.visuals.at(-1)?.propHint).toBe('none');
    expect(f.observed[0]).toMatchObject({ activity: 'book', cause: acceptedDrag ? 'user_interrupted' : 'other', source: acceptedDrag ? 'user' : 'system', participation: 'solitary' });
    expect(f.character.getCausalEmotion()?.target).toBe(acceptedDrag ? 'user' : undefined);
    f.at(14_000); expect(f.observed).toHaveLength(1); expect(f.character.getState().needs.energy).toBe(60);
  }
});
it('rejects invalid support and nonlocal commands, and clears the prop on support or mode loss', () => {
  const f = fixture();
  expect(f.runtime.start({ ...book, source: 'user' })).toBe(false);
  expect(f.runtime.start({ ...book, source: 'provider' })).toBe(false);
  expect(f.runtime.start(book, { book: false })).toBe(false);
  const environment = f.environment();
  expect(hasBookSupport({ ...environment, capturedAtMs: -301 }, f.root, f.insets, 0)).toBe(false);
  expect(hasBookSupport(environment, { ...f.root, y: 789 }, f.insets, 0)).toBe(false);
  expect(hasBookSupport(environment, f.root, { ...f.insets, left: NaN }, 0)).toBe(false);
  f.runtime.start(book); f.at(1200); f.setSupported(); f.at(1300);
  expect(f.observed[0]?.cause).toBe('environment_lost'); expect(f.visuals.at(-1)?.propHint).toBe('none');
  const quiet = fixture(); quiet.runtime.start(book); quiet.at(1200); quiet.setAllowed(); quiet.at(1300);
  expect(quiet.observed[0]?.cause).toBe('other'); expect(quiet.visuals.at(-1)?.propHint).toBe('none');
});
it('allows book through the same seeded Utility cutoff, then offers another activity during its cooldown', () => {
  const f = fixture(), snapshot = createCharacterAutonomySnapshot(f.character.getState(), 1);
  const context = { nowMs: 0, canBook: f.runtime.canStart(book), canExplore: false, canPlay: false, canRest: false, history: [] };
  const chosen = selectLocalActivity(snapshot, context, .5);
  expect(chosen.intent).toMatchObject(book);
  expect(chosen.trace.find(row => row.kind === 'book')).toMatchObject({ selected: true, factors: { repetition: 1 }, goalMultiplier: 1, planMultiplier: 1, copingMultiplier: 1, habitMultiplier: 1, emotionMultiplier: 1 });
  f.runtime.start(chosen.intent); f.at(1200); f.recorder.beginInput(true, 1200); f.runtime.cancel('user_interaction'); f.recorder.endInput();
  expect(selectLocalActivity(snapshot, { ...context, canBook: f.runtime.canStart(book) }, .5).intent.kind).toBe('idle');
});
