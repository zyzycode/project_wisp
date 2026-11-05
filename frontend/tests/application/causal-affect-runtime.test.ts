import { expect, it, vi } from 'vitest';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { CausalLifeRecorder } from '../../src/application/services/causal-life-recorder';
import type { CausalObservedEvent } from '../../src/domain/character/causal-affect';
import type { ICausalLifeRepository } from '../../src/application/ports/causal-life.interface';
import type { ActivityOutcomeFeedback } from '../../src/application/ports/shimeji-feedback-port';

const contact: CausalObservedEvent = { sequence: 1, source: 'user', triggerSequence: null,
  activityRunId: null, activity: null, outcome: null, cause: 'contact', executedMs: 0, participation: 'none' };
const supportive = { category: 'supportive', intensity: 'low', confidence: 'clear' } as const;

it('observes local facts without persistence/provider or a second base, reward, axes or consent effect', () => {
  let now = 30_000;
  const service = new CharacterStateService({ monotonicNow: () => now, now: () => 0 });
  const before = service.getState();
  service.observeCausalEpisode(contact, now);
  service.observeCausalEpisode(contact, now);
  expect(service.getState()).toEqual(before);
  expect(service.getCausalEmotion()).toMatchObject({ kind: 'curious', target: 'self', intensity: 0.1 });
  const receipt = service.beginTouch(1, true), postBase = service.getState();
  expect(receipt.effectPolicy).toBe('suppressed');
  expect(postBase.needs.attention).toBe(before.needs.attention - 2);
  expect(service.commitTouch(receipt, supportive).effect).toBe('suppressed');
  expect(service.getState()).toEqual(postBase);
  expect(service.commitTouch(receipt, supportive).effect).toBe('rejected');
  now += 30_000; service.tickNeeds(30_000);
  expect(service.getCausalEmotion()?.intensity).toBe(0.05);
  now++; service.tickNeeds(1);
  expect(service.getCausalEmotion()).toBeNull();
});

it('causal-bound touch suppression leaves ordinary chat and unbound touch semantic effects intact', () => {
  let now = 0;
  const service = new CharacterStateService({ monotonicNow: () => now, now: () => 0 });
  now = 30_000;
  expect(service.commitTouch(service.beginTouch(1, true), supportive).effect).toBe('suppressed');
  expect(service.commitChat(service.beginChat(2), supportive).effect).toBe('accepted');
  now = 60_000;
  expect(service.commitTouch(service.beginTouch(3), supportive).effect).toBe('accepted');
});

it('reset and restoration clear affect/repetition, and stale provider completion cannot restore it', () => {
  let now = 0;
  const service = new CharacterStateService({ monotonicNow: () => now, now: () => 0 });
  service.observeCausalEpisode(contact, 0);
  const receipt = service.beginTouch(1, true), checkpoint = service.getState();
  service.resetToDefaults();
  expect(service.getCausalEmotion()).toBeNull();
  expect(service.commitTouch(receipt, supportive).effect).toBe('rejected');
  expect(service.getCausalEmotion()).toBeNull();
  now = 1_000; service.observeCausalEpisode(contact, now);
  expect(service.getCausalEmotion()).not.toBeNull();
  service.replaceRestoredState(checkpoint);
  expect(service.getCausalEmotion()).toBeNull();
  expect(new CharacterStateService({ initialState: checkpoint }).getCausalEmotion()).toBeNull();
});

it('verified recorder inputs appraise offline before storage settles, with reset and dispose barriers', async () => {
  let now = 0, generation = 0;
  const service = new CharacterStateService({ monotonicNow: () => now, now: () => 0 });
  let settle: (() => void) | undefined;
  const append = vi.fn<ICausalLifeRepository['append']>().mockImplementation(() => new Promise(resolve => {
    settle = () => resolve({ ok: true, value: undefined });
  }));
  let persistent = false;
  const recorder = new CausalLifeRecorder({
    repository: { append, getRecent: vi.fn(), resolveSources: vi.fn() },
    appRunId: () => `app-${generation}`, context: () => persistent ? { generation } : null,
    generation: () => generation, toTimestamp: at => new Date(at).toISOString(), onFailure: vi.fn(),
    onObserved: (episode, atMs) => service.observeCausalEpisode(episode, atMs),
  });
  recorder.beginInput(true, now); recorder.endInput();
  expect(service.getCausalEmotion()).toMatchObject({ cause: 'contact', kind: 'curious' });
  expect(append).not.toHaveBeenCalled();
  now = 2_000; persistent = true;
  const terminal: ActivityOutcomeFeedback = { type: 'activity_outcome', eventId: 'run:terminal',
    activityRunId: 'run', activitySequence: 1, activity: 'cursor_game', terminalReason: 'user_interaction',
    atMs: now, family: 'cursor_interest', outcome: 'cancelled', participation: 'user_engaged', executedMs: 1_500, playCompleted: false };
  recorder.beginInput(true, now); recorder.outcome(terminal); recorder.endInput();
  expect(service.getCausalEmotion()).toMatchObject({ cause: 'user_interrupted', kind: 'irritated', intensity: 0.2, target: 'user' });
  const before = service.getCausalEmotion(); recorder.outcome(terminal);
  expect(service.getCausalEmotion()).toEqual(before);
  generation++; recorder.reset(); service.resetToDefaults();
  settle?.(); await Promise.resolve();
  expect(service.getCausalEmotion()).toBeNull();
  recorder.dispose(); recorder.beginInput(true, now); recorder.outcome({ ...terminal, activitySequence: 2 });
  expect(service.getCausalEmotion()).toBeNull();
});
