import { afterEach, expect, it, vi } from 'vitest';
import { MemoryHistory } from '../../src/application/services/memory-history';
import { AIEventRuntime } from '../../src/application/services/ai-event-runtime';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { QuietSupportRuntime } from '../../src/application/services/quiet-support-runtime';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import type { DialogueRuntimeOptions } from '../../src/application/ports/dialogue-runtime';
import type { AIProviderRequest, AIProviderResponse } from '../../src/application/ports/ai-provider.interface';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function fixture(locale = 'ru', topic = false, eventRuntime?: DialogueRuntimeOptions['events']) {
  vi.useFakeTimers(); vi.setSystemTime(0); let id = 0;
  const invalidate = vi.fn(), quietSupport = new QuietSupportRuntime(invalidate);
  const provider = { ...(topic ? { supportsDialogueTopic: true as const } : {}), getStatus: vi.fn(async () => ({ kind: 'ready' as const })), generateResponse: vi.fn(async (request: AIProviderRequest): Promise<AIProviderResponse> => ({ requestId: request.requestId, status: 'ok' as const, reply: { text: 'Hello' }, confidence: 1 })) };
  const acceptedContact = vi.fn();
  const completed = vi.fn(), applyStimulus = vi.fn();
  const admit = vi.fn<NonNullable<NonNullable<DialogueRuntimeOptions['memory']>['interestThread']>['admit']>(async () => ({ ok: true as const, value: { kind: 'continue' as const, generation: 0 } }));
  const prepare = vi.fn<NonNullable<NonNullable<DialogueRuntimeOptions['memory']>['interestThread']>['prepare']>(async () => ({ ok: true, value: null }));
  const interestThread: NonNullable<NonNullable<DialogueRuntimeOptions['memory']>['interestThread']> = { admit, prepare, isCurrent: () => true };
  const events = { interruptForUser: vi.fn(async () => undefined), invalidate: vi.fn(), suppressUnsolicited: vi.fn(), takePreviousInitiative: vi.fn(() => undefined) };
  const runtime = new DialogueRuntime({ getSemanticSleepState: () => 'awake', onAcceptedUserInput: acceptedContact, provider, quietSupport, locale, events: eventRuntime ?? events, now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `id-${++id}`,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    memory: { generation: () => 0, completed, ...(topic ? { interestThread } : {}) },
    getCharacterSnapshot: () => new CharacterStateService().getSnapshot(), applyStimulus, offerIntent: vi.fn(), publish: vi.fn(), beginThinking: vi.fn(), endThinking: vi.fn(), transaction: commit => commit() });
  runtime.replaceStream('stream'); let sequence = 0;
  const send = (text = 'Hello', extra = {}) => runtime.receive({ type: 'send', text, streamId: 'stream', conversationId: runtime.getPresentation().conversationId, sequence: ++sequence, ...extra });
  return { acceptedContact, runtime, send, provider, completed, quietSupport, invalidate, applyStimulus, admit, prepare, events };
}
afterEach(() => vi.useRealTimers());
it.each([['ru', '  МНЕ ОТ ЭТОГО НЕ ЛЕГЧЕ !?.  ', 'Поняла. Я рядом.'], ['en', 'That doesn’t make me feel better!!!', "I understand. I'm here."]])('acknowledges exact %s cue once without provider, topic admission or evidence', async (locale, cue, ack) => {
  const f = fixture(locale, true); f.send(); await flush(); f.provider.generateResponse.mockClear(); f.admit.mockClear(); f.applyStimulus.mockClear(); f.acceptedContact.mockClear();
  expect(f.send(cue).status).toBe('accepted');
  expect(f.acceptedContact).toHaveBeenCalledOnce();
  expect(f.runtime.getPresentation()).toMatchObject({ turn: { phase: 'completed', replyText: ack, outcome: { kind: 'local', reason: 'quiet_support' } } });
  await flush(); expect(f.quietSupport.isActive()).toBe(true); expect(f.invalidate).toHaveBeenCalledOnce();
  expect(f.provider.generateResponse).not.toHaveBeenCalled(); expect(f.admit).not.toHaveBeenCalled();
  expect(f.completed.mock.calls.at(-1)?.[0]).toMatchObject({ memoryConfirmable: false, assistant: { text: ack } });
  expect(f.applyStimulus).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'user_message' }));
  f.send(cue); await flush(); expect(f.quietSupport.isActive()).toBe(false); expect(f.provider.generateResponse).toHaveBeenCalledOnce();
});
it.each(['"мне от этого не легче"', 'мне от этого не легче сегодня', 'That does not make me feel better'])('does not trigger on %s', async cue => {
  const f = fixture(); f.send(); await flush(); f.send(cue); await flush(); expect(f.quietSupport.isActive()).toBe(false); expect(f.provider.generateResponse).toHaveBeenCalledTimes(2);
});
it('requires a published successful reply and explicit topic binding takes precedence', async () => {
  const f = fixture('ru', true); f.send('мне от этого не легче'); await flush(); expect(f.quietSupport.isActive()).toBe(false);
  f.send('мне от этого не легче', { replyToInterestThread: { threadId: 'topic', revision: 1 } }); await flush(); expect(f.quietSupport.isActive()).toBe(false); expect(f.admit).toHaveBeenCalledTimes(2);
});
it('retains latch across reset/reload and clears it on full memory reset/dispose', async () => {
  const f = fixture(); f.send(); await flush(); f.send('мне от этого не легче');
  f.runtime.replaceStream('next'); expect(f.quietSupport.isActive()).toBe(true); expect(f.runtime.getPresentation().turn.phase).toBe('idle');
  f.runtime.cancelForMemoryReset(); expect(f.quietSupport.isActive()).toBe(false);
  f.quietSupport.enter(); f.runtime.dispose(); expect(f.quietSupport.isActive()).toBe(false);
});

it('fallback, stale, duplicate and busy sends cannot enter or release the latch', async () => {
  const f = fixture();
  f.provider.generateResponse.mockImplementationOnce(async request => ({ requestId: request.requestId, status: 'fallback', reply: { text: 'Fallback' }, confidence: 0 }));
  f.send(); await flush(); f.send('мне от этого не легче'); await flush();
  expect(f.quietSupport.isActive()).toBe(false);
  f.send('мне от этого не легче'); expect(f.quietSupport.isActive()).toBe(true);
  const current = f.runtime.getPresentation();
  expect(f.runtime.receive({ type: 'send', text: 'continue', sequence: 3, streamId: 'stream', conversationId: current.conversationId })).toMatchObject({ status: 'rejected', reason: 'stale' });
  expect(f.quietSupport.isActive()).toBe(true);
  f.send('continue'); expect(f.quietSupport.isActive()).toBe(false);
  f.send('мне от этого не легче'); expect(f.quietSupport.isActive()).toBe(false);
  await flush();
});
it('a pending topic group owns admission until its 200ms deadline and cannot trigger support', async () => {
  const f = fixture('ru', true); f.send(); await flush();
  let settle!: (value: { ok: true; value: { kind: 'continue'; generation: number } }) => void;
  f.admit.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  f.send('ordinary next turn'); await flush();
  expect(f.send('мне от этого не легче')).toMatchObject({ status: 'rejected', reason: 'busy' });
  expect(f.quietSupport.isActive()).toBe(false);
  await vi.advanceTimersByTimeAsync(200); await flush();
  settle({ ok: true, value: { kind: 'continue', generation: 0 } }); await flush();
  f.send('мне от этого не легче'); expect(f.quietSupport.isActive()).toBe(true);
});
it('dialogue reset preserves the latch but clears previous-reply eligibility', async () => {
  const f = fixture(); f.send(); await flush(); f.send('мне от этого не легче');
  expect(f.runtime.receive({ type: 'reset', sequence: 10, streamId: 'stream', conversationId: f.runtime.getPresentation().conversationId }).status).toBe('accepted');
  expect(f.quietSupport.isActive()).toBe(true);
  f.send('мне от этого не легче', { sequence: 11 }); await flush();
  expect(f.quietSupport.isActive()).toBe(false); expect(f.provider.generateResponse).toHaveBeenCalledTimes(2);
});

it('accepts unbound support after a successful topic follow-up without reusing its topic, then clears lastOffered', async () => {
  const f = fixture('ru', true), ref = { threadId: 'thread', revision: 1 };
  f.prepare.mockImplementationOnce(async input => ({ ok: true, value: { use: { ref, requestId: input.requestId, userMessageId: input.userMessageId, mode: 'follow_up' }, topic: { mode: 'follow_up', text: 'Interview', statedAt: new Date().toISOString() }, expiresAt: new Date(100000).toISOString(), generation: 0 } }));
  f.send(); await flush(); expect(f.runtime.getPresentation()).toMatchObject({ turn: { interestThread: ref } });
  expect(f.send('мне от этого не легче').status).toBe('accepted');
  expect(f.quietSupport.isActive()).toBe(true); expect(f.provider.generateResponse).toHaveBeenCalledOnce(); expect(f.prepare).toHaveBeenCalledOnce(); expect(f.admit).toHaveBeenCalledOnce();
  const local = f.completed.mock.calls.at(-1)?.[0]; expect(local.interestThread).toBeUndefined(); expect(local.localOnly).toBe(true);
  f.send('continue'); await flush(); expect(f.admit.mock.calls.at(-1)?.[0]).not.toHaveProperty('lastOffered');
});
it('preserves an actual pending direct-touch response through an accepted support cue', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0); let f: ReturnType<typeof fixture>;
  let resolve!: (value: { requestId: string; replyText: string }) => void;
  const generateEvent = vi.fn((_request: { requestId: string }) => new Promise<{ requestId: string; replyText: string }>(yes => { resolve = yes; }));
  const cancel = vi.fn();
  const events = new AIEventRuntime({ provider: { generateEvent, cancel }, now: Date.now, timestamp: () => new Date().toISOString(), createId: () => 'touch',
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    character: () => new CharacterStateService().getSnapshot(), publish: vi.fn(),
    gate: () => ({ allowed: !f.quietSupport.isActive(), touchAllowed: true, identity: f.runtime.getIdentity(), memoryGeneration: 0, activeRunId: null, localSpeech: false }) });
  f = fixture('ru', false, events); f.send(); await flush(); events.touch(); await flush();
  expect(generateEvent).toHaveBeenCalledOnce(); f.send('мне от этого не легче'); expect(cancel).not.toHaveBeenCalled();
  resolve({ requestId: 'touch', replyText: 'Direct touch response' }); await flush();
  expect(events.getSpeech()?.text).toBe('Direct touch response'); expect(f.quietSupport.isActive()).toBe(true); events.dispose(); f.runtime.dispose();
});
it('failed local history writes never retry ACK or turn its source into evidence', async () => {
  const f = fixture(); f.send(); await flush();
  const appendTurn = vi.fn(async () => ({ ok: false as const, code: 'io_error' as const })), onPersisted = vi.fn(), onFailure = vi.fn();
  const success = async () => ({ ok: true as const, value: undefined });
  const history = new MemoryHistory({ history: { appendTurn, getRecent: async () => ({ ok: true, value: [] }), closeSession: success, closeUnfinishedSessions: success },
    episodes: { append: success }, context: () => ({ generation: 0 }), createId: () => 'history', toTimestamp: () => new Date().toISOString(), onPersisted, onFailure });
  f.completed.mockImplementationOnce(turn => { void history.completed(turn); });
  f.send('мне от этого не легче'); const ack = f.runtime.getPresentation(); await flush();
  expect(appendTurn).toHaveBeenCalledOnce(); expect(onFailure).toHaveBeenCalledWith('io_error'); expect(onPersisted).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60000); expect(f.runtime.getPresentation()).toEqual(ack);
  expect(f.runtime.confirmableSource({ userMessageId: 'unknown', assistantMessageId: 'unknown' }, ack.conversationId)).toBeNull();
  f.send('мне от этого не легче'); await flush();
  expect(f.invalidate).toHaveBeenCalledOnce(); expect(f.provider.generateResponse).toHaveBeenCalledTimes(2);
});
