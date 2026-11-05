import { afterEach, expect, it, vi } from 'vitest';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { CausalExpressionRuntime } from '../../src/application/services/causal-expression-runtime';
import { MockAIProvider } from '../../src/infrastructure/ai/mock-ai-provider';
import type { AIProviderRequest, AIProviderResponse, IAIProvider } from '../../src/application/ports/ai-provider.interface';
import type { CausalEmotion } from '../../src/domain/character/causal-affect';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { emptyMemoryContext } from '../../src/application/services/memory-recall';
import { VoiceOutputService } from '../../src/application/services/voice-output-service';
import type { BrainStateDTO } from '../../src/shared/ipc-contracts';

const flush = async () => { for (let i = 0; i < 35; i++) await Promise.resolve(); };
const response = (r: AIProviderRequest, text = 'A reply'): AIProviderResponse => ({ requestId: r.requestId, status: 'ok',
  reply: { text, tone: 'playful' }, suggestedBehavior: 'play', suggestedMood: 'happy', confidence: 1 });
function fixture(provider: IAIProvider, causal = true) {
  vi.useFakeTimers(); vi.setSystemTime(0); let id = 0, generation = 0, owner = 'owner', activeRunId: string | null = null, consent = false;
  let emotion: CausalEmotion | null = causal ? { activity: 'cursor_game', causeSequence: 3, cause: 'user_interrupted', kind: 'irritated', intensity: .3, target: 'user' } : null;
  const character = new CharacterStateService({ now: Date.now, monotonicNow: Date.now });
  const director = new CausalExpressionRuntime({ now: Date.now, read: () => ({ generation, owner, activeRunId, consent,
    romanceAllowed: false, emotion, deferredInvitation: false, ownGameInterest: 'none' }) });
  const applyStimulus = vi.fn(stimulus => character.applyStimulus(stimulus)), offerIntent = vi.fn(), completed = vi.fn(), setBehaviorContext = vi.fn();
  const runtime = new DialogueRuntime({ getSemanticSleepState: () => 'awake', provider, causalExpression: director,
    now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`, locale: 'en',
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    getCharacterSnapshot: () => character.getSnapshot(), applyStimulus, offerIntent, setBehaviorContext, memory: { generation: () => generation, completed },
    beginThinking: vi.fn(), endThinking: vi.fn(), publish: vi.fn(), transaction: commit => commit() });
  runtime.replaceStream('stream'); let sequence = 0;
  const send = (text = 'Why?') => runtime.receive({ type: 'send', text, streamId: 'stream', conversationId: runtime.getPresentation().conversationId, sequence: ++sequence });
  return { runtime, send, director, applyStimulus, offerIntent, completed, character, setBehaviorContext,
    change: (kind: string) => { if (kind === 'cause') emotion = { ...emotion!, activity: 'cursor_game', causeSequence: 4 }; if (kind === 'generation') generation++;
      if (kind === 'owner') owner = 'other'; if (kind === 'run') activeRunId = 'new-run'; if (kind === 'consent') consent = true;
      if (kind === 'clear') emotion = null; } };
}
afterEach(() => vi.useRealTimers());
it('two providers phrase the same local decision without applying opposite hints or activities', async () => {
  const requests: AIProviderRequest[] = [], states = [];
  for (const text of ['A different wording', 'Another wording']) {
    const provider: IAIProvider = { getStatus: async () => ({ kind: 'ready' }), generateResponse: async request => { requests.push(request); return response(request, text); } };
    const f = fixture(provider); f.send(); await flush();
    expect(f.runtime.getPresentation().turn).toMatchObject({ phase: 'completed', replyText: text, outcome: { kind: 'success' } });
    expect(f.runtime.getCausalExpression()).toMatchObject({ intent: 'give_space', emotion: 'irritated' });
    expect(f.offerIntent).not.toHaveBeenCalled(); expect(f.applyStimulus.mock.calls.map(call => call[0].type)).toEqual(['user_message']);
    states.push(f.character.getState()); f.runtime.dispose();
  }
  expect(requests[0]!.causalExpression).toEqual(requests[1]!.causalExpression); expect(states[0]).toEqual(states[1]);
});
it('retiring a stale causal response does not invoke the global context reset that cancels a new cursor owner', async () => {
  let complete: (value: AIProviderResponse) => void = () => {}; let request: AIProviderRequest | undefined;
  const f = fixture({ getStatus: async () => ({ kind: 'ready' }), generateResponse: r => { request = r; return new Promise(resolve => { complete = resolve; }); } });
  f.send(); await flush(); f.setBehaviorContext.mockClear(); f.change('run'); complete(response(request!)); await flush();
  expect(f.runtime.getPresentation().turn.phase).toBe('idle'); expect(f.setBehaviorContext).not.toHaveBeenCalled(); f.runtime.dispose();
});
it('ordinary dialogue retains its provider hints and has no causal block', async () => {
  const generateResponse = vi.fn(async (r: AIProviderRequest) => response(r)), f = fixture({ getStatus: async () => ({ kind: 'ready' }), generateResponse }, false);
  f.send(); await flush(); expect(generateResponse.mock.calls[0]![0].causalExpression).toBeUndefined();
  expect(f.offerIntent).toHaveBeenCalledOnce(); expect(f.runtime.getCausalExpression()).toBeUndefined(); f.runtime.dispose();
});
it.each(['cause', 'generation', 'owner', 'run', 'consent', 'clear', 'reset', 'dispose'])('discards the entire late reply after %s without history, effects or expression', async kind => {
  let complete: (value: AIProviderResponse) => void = () => {}; let request: AIProviderRequest | undefined;
  const generateResponse = vi.fn((r: AIProviderRequest) => { request = r; return new Promise<AIProviderResponse>(resolve => { complete = resolve; }); });
  const f = fixture({ getStatus: async () => ({ kind: 'ready' }), generateResponse, cancel: vi.fn() });
  f.send(); await flush(); expect(request?.causalExpression).toBeDefined();
  if (kind === 'reset') f.runtime.receive({ type: 'reset', streamId: 'stream', conversationId: f.runtime.getPresentation().conversationId, sequence: 2 });
  else if (kind === 'dispose') f.runtime.dispose(); else f.change(kind);
  complete(response(request!)); await flush();
  expect(f.runtime.getPresentation().turn.phase).toBe('idle'); expect(f.runtime.getCausalExpression()).toBeUndefined();
  expect(f.completed).not.toHaveBeenCalled(); expect(f.offerIntent).not.toHaveBeenCalled(); f.runtime.dispose();
});
it('uses the current local technical fallback and expression on outage and causal Mock, without another inference', async () => {
  const generateResponse = vi.fn(async (r: AIProviderRequest) => response(r));
  for (const provider of [{ getStatus: async () => ({ kind: 'offline' as const }), generateResponse }, new MockAIProvider({ simulatedLatencyMs: 0 })]) {
    const f = fixture(provider); f.send('Hello'); await flush();
    expect(f.runtime.getPresentation().turn).toMatchObject({ phase: 'completed', replyText: 'A reply is unavailable right now. Please try again later.', outcome: { kind: 'fallback' } });
    expect(f.runtime.getCausalExpression()?.emotion).toBe('irritated'); expect(f.offerIntent).not.toHaveBeenCalled(); f.runtime.dispose();
  }
  expect(generateResponse).not.toHaveBeenCalled();
});
it('bounds a causal request at five seconds and rejects late success without replacing its technical fallback', async () => {
  let complete: (value: AIProviderResponse) => void = () => {}; let request: AIProviderRequest | undefined;
  const generateResponse = vi.fn((r: AIProviderRequest) => { request = r; return new Promise<AIProviderResponse>(resolve => { complete = resolve; }); });
  const cancel = vi.fn(), f = fixture({ getStatus: async () => ({ kind: 'ready' }), generateResponse, cancel });
  f.send(); await flush(); vi.advanceTimersByTime(5000);
  expect(f.runtime.getPresentation().turn).toMatchObject({ phase: 'completed', outcome: { reason: 'timeout' } });
  expect(cancel).toHaveBeenCalledExactlyOnceWith(request!.requestId);
  complete(response(request!, 'Late words')); await flush();
  expect(f.runtime.getPresentation().turn).not.toMatchObject({ replyText: 'Late words' }); expect(f.completed).toHaveBeenCalledOnce(); f.runtime.dispose();
});
it('does not expose the capture object to a provider that mutates its own request', async () => {
  const f = fixture({ getStatus: async () => ({ kind: 'ready' }), generateResponse: async r => {
    Reflect.set(r.causalExpression!, 'emotion', 'content'); Reflect.set(r.causalExpression!, 'intent', 'respond'); return response(r);
  } });
  f.send(); await flush(); expect(f.runtime.getCausalExpression()).toMatchObject({ emotion: 'irritated', intent: 'give_space' }); f.runtime.dispose();
});
it.each([401, 503])('handles HTTP %i without leaking provider details, duplicate inference or opposite local expression', async status => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ secret: 'private-provider-details' }), { status, headers: { 'content-type': 'application/json' } }));
  const client = new ExternalAIProviderClient({ baseUrl: 'https://backend.invalid', development: false, now: Date.now, fetch: fetcher });
  const f = fixture({ getStatus: () => client.getStatus(), cancel: id => client.cancel(id), generateResponse: request => client.generateResponse({ ...request,
    interaction: { card: { id: 'curiousStubbornGirl', revision: 3 }, effectPolicy: 'suppressed' }, memoryContext: emptyMemoryContext() }) });
  f.send(); await flush();
  expect(f.runtime.getPresentation().turn).toMatchObject({ phase: 'completed', replyText: 'A reply is unavailable right now. Please try again later.', outcome: { kind: 'fallback' } });
  expect(f.runtime.getCausalExpression()?.emotion).toBe('irritated'); expect(fetcher).toHaveBeenCalledOnce(); expect(f.offerIntent).not.toHaveBeenCalled(); f.runtime.dispose();
});
it('uses only supported neutral synthesis and cancels its matching voice when the causal identity becomes stale', async () => {
  const f = fixture({ getStatus: async () => ({ kind: 'ready' }), generateResponse: async r => response(r, 'Current reply') });
  const synthesizer = { ready: async () => true, dispose: async () => {}, synthesize: vi.fn((_text: string, _language: 'ru' | 'en', signal: AbortSignal) =>
    new Promise<{ sampleRate: 24000; samples: Float32Array }>((_yes, no) => signal.addEventListener('abort', () => no(new Error('Cancelled')), { once: true }))) };
  const current = () => ({ streamId: 'stream', dialogue: f.runtime.getPresentation(), autonomy: { quiet: false } });
  const voice = new VoiceOutputService({ synthesizer, createId: () => 'playback', language: () => 'en', current,
    blockInput: vi.fn(), revokeInput: vi.fn(), revokePlayback: vi.fn() });
  await voice.initialize(); voice.configure(true); f.send(); await flush();
  const turn = f.runtime.getPresentation().turn; if (turn.phase !== 'completed') throw new Error('Expected completion');
  const playback = voice.speak({ streamId: 'stream', conversationId: f.runtime.getPresentation().conversationId, requestId: turn.requestId });
  expect(synthesizer.synthesize).toHaveBeenCalledExactlyOnceWith('Current reply', 'en', expect.any(AbortSignal));
  f.change('cause');
  const snapshot: BrainStateDTO = { ...current(), revision: 1, sampledAtMs: 0, cursorGame: null, activity: null,
    character: { needs: { energy: 50, attention: 50, play: 50, comfort: 50, boredom: 50 }, synthesizedTone: 'neutral' },
    motion: { phase: 'grounded', positionAuthority: 'voluntary', rootScreenPosition: { x: 0, y: 0 }, velocityPxPerSec: { x: 0, y: 0 } },
    visualIntent: { episodeId: 'e', episodeSequence: 1, episodeStartedAtMs: 0, kind: 'idle_blink', category: 'idle', priority: 'low', interrupt: 'yes', loop: 'until_replaced', emotionalTone: 'neutral' } };
  voice.observe(snapshot); expect(await playback).toEqual({ ok: false, code: 'cancelled' });
  expect(await voice.speak({ streamId: 'stream', conversationId: snapshot.dialogue.conversationId, requestId: turn.requestId })).toEqual({ ok: false, code: 'stale' });
  await voice.dispose(); f.runtime.dispose();
});
it('retires an already published causal turn on source change so existing voice identity cannot be replayed', async () => {
  const f = fixture({ getStatus: async () => ({ kind: 'ready' }), generateResponse: async r => response(r) });
  f.send(); await flush(); expect(f.runtime.getPresentation().turn.phase).toBe('completed');
  f.change('cause'); expect(f.runtime.getPresentation().turn.phase).toBe('idle'); expect(f.runtime.getCausalExpression()).toBeUndefined(); f.runtime.dispose();
});
