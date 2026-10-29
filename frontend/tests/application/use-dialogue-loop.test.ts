import { MockAIProvider } from '../../src/infrastructure/ai/mock-ai-provider';
import { afterEach, expect, it, vi } from 'vitest';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import type { AIProviderRequest, AIProviderResponse, IAIProvider } from '../../src/application/ports/ai-provider.interface';

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function fixture(provider: IAIProvider) {
  vi.useFakeTimers(); vi.setSystemTime(0); let id = 0;
  const character = new CharacterStateService({ now: Date.now });
  const apply = vi.spyOn(character, 'applyStimulus'); const offerIntent = vi.fn();
  const runtime = new DialogueRuntime({ getSemanticSleepState: () => 'awake', provider, now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `id-${++id}`,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    getCharacterSnapshot: () => character.getSnapshot(), applyStimulus: stimulus => { character.applyStimulus(stimulus); },
    offerIntent, beginThinking: () => {}, endThinking: () => {}, transaction: commit => commit(), publish: () => {} });
  runtime.replaceStream('stream');
  const send = (sequence: number, text = '  Привет  ') => runtime.receive({ type: 'send', text, sequence, streamId: 'stream', conversationId: runtime.getPresentation().conversationId });
  return { runtime, send, character, apply, offerIntent };
}
function provider(response: (request: AIProviderRequest) => AIProviderResponse) {
  return { getStatus: vi.fn(async () => ({ kind: 'ready' as const })), generateResponse: vi.fn(async (request: AIProviderRequest) => response(request)) };
}
const success = (r: AIProviderRequest): AIProviderResponse => ({ requestId: r.requestId, status: 'ok', reply: { text: 'Привет!', tone: 'warm' }, confidence: 1 });
afterEach(() => vi.useRealTimers());

it('uses Main Character snapshot and keeps every fitting complete context pair', async () => {
  const p = provider(success), f = fixture(p);
  expect(f.send(1).status).toBe('accepted');
  const admittedSnapshot = f.character.getSnapshot(); await flush();
  for (let sequence = 2; sequence <= 5; sequence++) { expect(f.send(sequence).status).toBe('accepted'); await flush(); }
  const requests = p.generateResponse.mock.calls.map(call => call[0]);
  expect(requests.map(r => r.recentContext.length)).toEqual([0, 2, 4, 6, 8]);
  expect(requests[4]!.recentContext.map(m => m.role)).toEqual(['user', 'wisp', 'user', 'wisp', 'user', 'wisp', 'user', 'wisp']);
  expect(requests[0]!.userMessage.text).toBe('Привет');
  expect(requests[0]!.characterSnapshot).toEqual(admittedSnapshot);
  expect(f.apply.mock.calls.filter(c => c[0].type === 'user_message')).toHaveLength(5);
  expect(f.apply.mock.calls.filter(c => c[0].type === 'provider_response')).toHaveLength(5);
});
it.each(['offline', 'error', 'thinking'] as const)('handles provider status %s locally', async kind => {
  const p = { getStatus: vi.fn(async () => ({ kind })), generateResponse: vi.fn(async (r: AIProviderRequest) => success(r)) };
  const f = fixture(p); f.send(1); await flush();
  expect(p.generateResponse).not.toHaveBeenCalled(); expect(f.offerIntent).not.toHaveBeenCalled();
  expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: true, turn: { phase: 'completed', outcome: { reason: kind === 'offline' ? 'offline' : 'provider_error' } } });
});
it.each(['provider_unavailable', 'timeout', 'unexpected_error', 'unsupported_input'] as const)('keeps fallback text without its behavior hints: %s', async fallbackReason => {
  const p = provider(r => ({ ...success(r), status: 'fallback', suggestedBehavior: 'sleep', diagnostics: { provider: 'mock', latencyMs: 1, fallbackReason } }));
  const f = fixture(p); f.send(1); await flush(); expect(f.offerIntent).not.toHaveBeenCalled(); expect(f.apply).toHaveBeenCalledTimes(1);
  expect(f.runtime.getPresentation().turn).toMatchObject({ phase: 'completed', replyText: 'Привет!', outcome: { kind: 'fallback' } });
});
it.each(['id', 'empty', 'control', 'confidence'] as const)('rejects malformed response: %s', async mode => {
  const p = provider(r => ({ ...success(r), requestId: mode === 'id' ? 'foreign' : r.requestId,
    confidence: mode === 'confidence' ? NaN : 1, reply: { text: mode === 'empty' ? '  ' : mode === 'control' ? '\u0000bad' : 'ok' } }));
  const f = fixture(p); f.send(1); await flush();
  expect(f.runtime.getPresentation().turn).toMatchObject({ phase: 'completed', outcome: { reason: 'invalid_response' } });
  expect(f.apply).toHaveBeenCalledTimes(1); expect(f.offerIntent).not.toHaveBeenCalled();
});
it('limits reply/context to 2000 UTF-16 units and clears context on reset', async () => {
  const p = provider(r => ({ ...success(r), reply: { text: 'x'.repeat(3000) } })), f = fixture(p);
  f.send(1); await flush();
  expect(f.runtime.getPresentation().turn).toMatchObject({ replyText: 'x'.repeat(2000) });
  const conversationId = f.runtime.getPresentation().conversationId;
  expect(f.runtime.receive({ type: 'reset', sequence: 2, streamId: 'stream', conversationId }).status).toBe('accepted');
  f.send(3); await flush(); expect(p.generateResponse.mock.calls[1]![0].recentContext).toEqual([]);
});
it('timeout wins at the exact deadline even before the timer callback', async () => {
  const p = provider(r => { vi.setSystemTime(15000); return success(r); }), f = fixture(p);
  f.send(1); await flush(); expect(f.runtime.getPresentation().turn).toMatchObject({ outcome: { reason: 'timeout' } }); expect(f.offerIntent).not.toHaveBeenCalled();
});

it('Issue #105: real Mock unsupported replies complete degraded without applying provider intents or stimuli', async () => {
  const f = fixture(new MockAIProvider({ simulatedLatencyMs: 0 }));
  for (const [index, text] of ['Я не хочу играть', 'Не хочу спать', 'Почему?'].entries()) {
    expect(f.send(index + 1, text).status).toBe('accepted'); await flush();
    expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: true, turn: { phase: 'completed',
      replyText: 'На это у меня пока нет подходящего ответа', outcome: { kind: 'fallback', reason: 'degraded' } } });
  }
  expect(f.offerIntent).not.toHaveBeenCalled();
  expect(f.apply.mock.calls.map(call => call[0].type)).toEqual(['user_message', 'user_message', 'user_message']);
});
it('Issue #105: real Mock supported requests still reach the existing intent route', async () => {
  const f = fixture(new MockAIProvider({ simulatedLatencyMs: 0 }));
  expect(f.send(1, 'Давай играть').status).toBe('accepted'); await flush();
  expect(f.runtime.getPresentation().turn).toMatchObject({ outcome: { kind: 'success' } });
  expect(f.offerIntent).toHaveBeenCalledOnce();
  expect(f.offerIntent.mock.calls[0]![0]).toMatchObject({ intent: { kind: 'play' } });
  expect(f.apply.mock.calls.map(call => call[0].type)).toEqual(['user_message', 'provider_response']);
});
