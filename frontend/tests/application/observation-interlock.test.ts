import { CharacterStateService } from '../../src/application/services/character-state.service';
import { TouchReactionContext } from '../../src/application/services/touch-reaction-context';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { observationFixture, flush } from './observation-fixture';
import { providerRequest } from '../infrastructure/backend-ai-fixture';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { AIEventRuntime } from '../../src/application/services/ai-event-runtime';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
const reply = (requestId: string, text: string) => new Response(JSON.stringify({ requestId, text, appraisal: { category: 'neutral', intensity: 'low', confidence: 'clear' } }), { headers: { 'Content-Type': 'application/json' } });
function fixture() {
  const f = observationFixture(); let finish!: () => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(reply(providerRequest().requestId, 'late')); }))
    .mockImplementation(async (_url, options) => { const body = JSON.parse(String(options?.body)) as { requestId: string }; return reply(body.requestId, 'User reply'); });
  const provider = new ExternalAIProviderClient({ baseUrl: 'https://example.com', development: false, now: Date.now, fetch: fetcher });
  f.canStartObservation.mockImplementation(() => provider.canStartObservation());
  f.generateObservation.mockImplementation((request, signal) => provider.generateObservation(request, signal));
  let id = 0;
  const dialogue = new DialogueRuntime({ getSemanticSleepState: () => 'awake', interactionEnabled: true, observation: f.runtime, provider, now: Date.now, timestamp: () => new Date().toISOString(),
    createId: () => `00000000-0000-4000-8000-${(++id).toString().padStart(12, '0')}`,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }, getCharacterSnapshot: () => providerRequest().characterSnapshot,
    transaction: callback => callback(), applyStimulus: vi.fn(), beginThinking: vi.fn(), endThinking: vi.fn(), publish: vi.fn(), offerIntent: vi.fn() });
  dialogue.replaceStream('s');
  const send = () => dialogue.receive({ type: 'send', streamId: 's', conversationId: dialogue.getPresentation().conversationId, sequence: 1, text: 'Привет' });
  return { ...f, fetcher, provider, dialogue, send, settle: () => finish() };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000000); });
afterEach(() => vi.useRealTimers());
it('accepted chat remains available during observation and starts only after old HTTP settles', async () => {
  const f = fixture(); f.runtime.enable(); await f.dwell(); expect(f.dialogue.getPresentation().canSubmit).toBe(true);
  expect(f.send().status).toBe('accepted'); await flush(); expect(f.generateObservation.mock.calls[0]?.[1].aborted).toBe(true); expect(f.fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000); f.settle(); await flush(); expect(f.fetcher).toHaveBeenCalledTimes(2);
  expect(String(f.fetcher.mock.calls[1]?.[0])).toContain('/v1/chat'); expect(f.runtime.getSpeech()).toBeNull(); expect(f.dialogue.getPresentation().turn.phase).toBe('completed'); f.dialogue.dispose();
});
it('accepted touch preempts observation, awaits HTTP settlement and never emits previousInitiative from observation', async () => {
  const f = fixture(); const character = new CharacterStateService({ now: Date.now, monotonicNow: Date.now }); const touchContext = new TouchReactionContext(character, Date.now); const event = new AIEventRuntime({ touchContext, observation: f.runtime, provider: f.provider, now: Date.now, timestamp: () => new Date().toISOString(), createId: () => providerRequest().requestId,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }, gate: () => ({ allowed: !f.runtime.isBusy(), touchAllowed: true, identity: 's', memoryGeneration: 0, activeRunId: null, localSpeech: false }),
    character: () => providerRequest().characterSnapshot, publish: vi.fn() });
  f.runtime.enable(); await f.dwell(); event.touch(character.beginTouch(1)); await flush(); expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.generateObservation.mock.calls[0]?.[1].aborted).toBe(true);
  f.settle(); await flush(); expect(f.fetcher).toHaveBeenCalledTimes(2); expect(String(f.fetcher.mock.calls[1]?.[0])).toContain('/v1/touch'); expect(event.getSpeech()?.text).toBe('User reply'); expect(event.takePreviousInitiative()).toBeUndefined(); event.dispose(); f.dialogue.dispose();
});
it('uncooperative aborted HTTP fails next user request safely without overlap or stuck canSubmit', async () => {
  const f = fixture(); f.runtime.enable(); await f.dwell(); f.send(); await flush(); await vi.advanceTimersByTimeAsync(3000); await flush();
  expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.dialogue.getPresentation().canSubmit).toBe(true); expect(f.runtime.getSpeech()).toBeNull(); f.settle(); await flush(); f.dialogue.dispose();
});
it('reset while chat awaits observation settlement prevents its later fetch', async () => {
  const f = fixture(); f.runtime.enable(); await f.dwell(); f.send(); await flush(); f.dialogue.clearMemoryContext(); f.settle(); await flush(); expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.runtime.getSettings().paused).toBe(true); f.dialogue.dispose();
});
