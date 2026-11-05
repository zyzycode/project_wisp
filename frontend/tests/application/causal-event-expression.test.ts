import { afterEach, expect, it, vi } from 'vitest';
import { AIEventRuntime } from '../../src/application/services/ai-event-runtime';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { CausalExpressionRuntime } from '../../src/application/services/causal-expression-runtime';
import { TouchReactionContext } from '../../src/application/services/touch-reaction-context';
import type { AIEventProviderRequest, AIEventProviderResponse } from '../../src/application/ports/ai-event-provider.interface';
import type { CausalObservedEvent } from '../../src/domain/character/causal-affect';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const neutral = { category: 'neutral', intensity: 'low', confidence: 'clear' } as const;
function fixture(generateEvent: (r: AIEventProviderRequest) => Promise<AIEventProviderResponse>) {
  vi.useFakeTimers(); vi.setSystemTime(0); let id = 0, generation = 0, owner = 'owner', activeRunId: string | null = null;
  const character = new CharacterStateService({ now: Date.now, monotonicNow: Date.now });
  const episode: CausalObservedEvent = { sequence: 2, source: 'user', triggerSequence: 1, activityRunId: 'game-1', activity: 'cursor_game',
    outcome: 'cancelled', cause: 'user_interrupted', executedMs: 1000, participation: 'user_engaged' };
  vi.setSystemTime(1000); character.observeCausalEpisode(episode, Date.now());
  vi.setSystemTime(2000); character.observeCausalEpisode({ ...episode, sequence: 4, triggerSequence: 3, activityRunId: 'game-2' }, Date.now());
  const director = new CausalExpressionRuntime({ now: Date.now, read: () => ({ generation, owner, activeRunId,
    consent: false, romanceAllowed: false, emotion: character.getCausalEmotion(), deferredInvitation: false, ownGameInterest: 'none' }) });
  const touchContext = new TouchReactionContext(character, Date.now), cancel = vi.fn(), publish = vi.fn();
  const runtime = new AIEventRuntime({ provider: { generateEvent, cancel }, causalExpression: director, touchContext,
    now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `event-${++id}`, scheduler: { setTimeout, clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) },
    gate: () => ({ allowed: true, touchAllowed: true, identity: 'dialogue', memoryGeneration: generation, activeRunId, localSpeech: false }),
    character: () => character.getSnapshot(), publish });
  const start = () => { const receipt = character.beginTouch(1, true); runtime.touch(receipt); return character.getState(); };
  return { runtime, character, start, cancel, publish, touchContext,
    startSocial: () => { activeRunId = 'social'; runtime.socialStarted('social', Date.now()); }, change: (kind: string) => {
    if (kind === 'cause') character.observeCausalEpisode({ ...episode, sequence: 6, triggerSequence: 5, activityRunId: 'game-3' }, Date.now());
    if (kind === 'generation') generation++; if (kind === 'owner') owner = 'other';
    if (kind === 'reset') runtime.invalidate(); if (kind === 'dispose') runtime.dispose();
  } };
}
afterEach(() => vi.useRealTimers());
it('sends the Character-owned cause once and keeps validated words with neutral suppressed appraisal', async () => {
  const generate = vi.fn(async (r: AIEventProviderRequest) => ({ requestId: r.requestId, replyText: 'Current words', appraisal: neutral }));
  const f = fixture(generate), afterBase = f.start(); await flush();
  expect(generate).toHaveBeenCalledOnce(); expect(generate.mock.calls[0]![0]).toMatchObject({
    causalExpression: { intent: 'give_space', emotion: 'irritated', cause: 'user_interrupted' }, interaction: { effectPolicy: 'suppressed' } });
  expect(f.runtime.getSpeech()?.text).toBe('Current words'); expect(f.runtime.getCausalExpression()?.emotion).toBe('irritated');
  expect(f.character.getState()).toEqual(afterBase); f.runtime.dispose();
});
it('does not let an expired speech capture invalidate the next independently admitted social run', async () => {
  const generate = vi.fn(async (r: AIEventProviderRequest) => ({ requestId: r.requestId, replyText: 'Current words',
    ...(r.event.type === 'user_touch' ? { appraisal: neutral } : {}) }));
  const f = fixture(generate); f.start(); await flush(); vi.advanceTimersByTime(2000);
  f.startSocial(); expect(f.runtime.getSpeech()).toBeNull(); await flush();
  expect(generate).toHaveBeenCalledTimes(2); expect(f.runtime.getSpeech()?.text).toBe('Current words'); f.runtime.dispose();
});
it.each(['cause', 'generation', 'owner', 'reset', 'dispose'])('does not publish late touch text, trace or expression after %s', async kind => {
  let request: AIEventProviderRequest | undefined, finish: (r: AIEventProviderResponse) => void = () => {};
  const f = fixture(r => { request = r; return new Promise(resolve => { finish = resolve; }); });
  f.start(); await flush(); f.change(kind); finish({ requestId: request!.requestId, replyText: 'Stale', appraisal: neutral }); await flush();
  expect(f.runtime.getSpeech()).toBeNull(); expect(f.runtime.getCausalExpression()).toBeUndefined(); expect(f.touchContext.get()).toBeUndefined(); f.runtime.dispose();
});
it('rejects a mismatched semantic proposal and uses the existing local touch fact without rewarding it', async () => {
  const f = fixture(async r => ({ requestId: r.requestId, replyText: 'Unaccepted wording', appraisal: { category: 'supportive', intensity: 'low', confidence: 'clear' } }));
  const afterBase = f.start(); await flush();
  expect(f.runtime.getSpeech()?.text).toBe('Я заметила касание.'); expect(f.runtime.getCausalExpression()?.emotion).toBe('irritated');
  expect(f.character.getState()).toEqual(afterBase); f.runtime.dispose();
});
it('cancels at five seconds and never replaces the once-only technical touch fallback with late success', async () => {
  let request: AIEventProviderRequest | undefined, finish: (r: AIEventProviderResponse) => void = () => {};
  const f = fixture(r => { request = r; return new Promise(resolve => { finish = resolve; }); });
  f.start(); await flush(); vi.advanceTimersByTime(5000);
  expect(f.cancel).toHaveBeenCalledExactlyOnceWith(request!.requestId); expect(f.runtime.getSpeech()?.text).toBe('Я заметила касание.');
  const published = f.publish.mock.calls.length;
  finish({ requestId: request!.requestId, replyText: 'Late', appraisal: neutral }); await flush();
  expect(f.runtime.getSpeech()?.text).toBe('Я заметила касание.'); expect(f.publish.mock.calls.length).toBe(published); f.runtime.dispose();
});
