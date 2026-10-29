import { afterEach, expect, it, vi } from 'vitest';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { emptyMemoryContext } from '../../src/application/services/memory-recall';
import type { DialogueRuntimeOptions } from '../../src/application/ports/dialogue-runtime';
import type { AIProviderRequest, AIProviderResponse, AIProviderStatus } from '../../src/application/ports/ai-provider.interface';
import type { ILocalMemoryRecall } from '../../src/application/ports/memory-knowledge.interface';
import type { IInterestThreadDialogue } from '../../src/application/ports/interest-thread.interface';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
type Stage = 'status' | 'recall' | 'admission' | 'response';
function fixture(stage: Stage = 'response', locale = 'ru', interaction = false) {
  vi.useFakeTimers(); vi.setSystemTime(0);
  let id = 0, sequence = 0, streamId = 'stream';
  let sleepState: 'awake' | 'sleeping' | 'unavailable' = 'awake';
  const status = deferred<AIProviderStatus>(), response = deferred<AIProviderResponse>();
  const recallResult = deferred<Awaited<ReturnType<ILocalMemoryRecall['recall']>>>();
  const admissionResult = deferred<Awaited<ReturnType<IInterestThreadDialogue['admit']>>>();
  const recall = vi.fn<ILocalMemoryRecall['recall']>(() => recallResult.promise);
  const admit = vi.fn<IInterestThreadDialogue['admit']>(() => admissionResult.promise);
  const provider = {
    getStatus: vi.fn(() => stage === 'status' ? status.promise : Promise.resolve({ kind: 'ready' as const })),
    generateResponse: vi.fn((_request: AIProviderRequest) => response.promise), cancel: vi.fn(),
  };
  const completed = vi.fn(), accepted = vi.fn(), applyStimulus = vi.fn(), offerIntent = vi.fn();
  const beginThinking = vi.fn(), endThinking = vi.fn(), setBehaviorContext = vi.fn(), publish = vi.fn();
  const chatMotion = { submit: vi.fn(), cancel: vi.fn() };
  const quietSupport = { isActive: vi.fn(() => false), enter: vi.fn(), resumeForUserDialogue: vi.fn(), resetMemory: vi.fn(), dispose: vi.fn() };
  const beginInteraction = vi.fn(() => ({ sequence: 1, generation: 0, signature: 'admitted', effectPolicy: 'eligible' as const }));
  const commitInteraction = vi.fn<NonNullable<DialogueRuntimeOptions['commitInteraction']>>(() => ({ effect: 'accepted', reason: 'applied' }));
  const getCharacterSnapshot = vi.fn(() => new CharacterStateService().getSnapshot());
  const options: DialogueRuntimeOptions = {
    getSemanticSleepState: () => sleepState, provider, locale, onAcceptedUserInput: accepted,
    ...(interaction ? { interactionEnabled: true, beginInteraction, commitInteraction } : {}),
    chatMotion, quietSupport, now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `id-${++id}`,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    getCharacterSnapshot, applyStimulus, offerIntent, beginThinking, endThinking, setBehaviorContext,
    transaction: commit => commit(), publish,
    memory: { generation: () => 0, completed, ...(stage === 'recall' ? { recall: { recall } } : {}),
      ...(stage === 'admission' ? { interestThread: { admit, prepare: vi.fn(async () => ({ ok: true as const, value: null })), isCurrent: () => true } } : {}) },
  };
  const runtime = new DialogueRuntime(options); runtime.replaceStream(streamId);
  const command = (text = 'Привет') => ({ type: 'send' as const, text, sequence: ++sequence, streamId, conversationId: runtime.getPresentation().conversationId });
  const send = (text?: string) => runtime.receive(command(text));
  const setSleep = (value: typeof sleepState, notify = true) => { sleepState = value; if (notify) runtime.notifySleepStateChanged(); };
  const success = (): AIProviderResponse => ({ requestId: provider.generateResponse.mock.calls.at(-1)![0].requestId, status: 'ok', reply: { text: 'Ответ' }, confidence: 1, suggestedBehavior: 'wander' });
  const settle = () => {
    if (stage === 'status') status.resolve({ kind: 'ready' });
    if (stage === 'recall') recallResult.resolve({ ok: true, value: emptyMemoryContext() });
    if (stage === 'admission') admissionResult.resolve({ ok: true, value: { kind: 'continue', generation: 0 } });
    if (stage === 'response') response.resolve(success());
  };
  const reload = () => { streamId = 'replacement'; sequence = 0; runtime.replaceStream(streamId); };
  return { runtime, options, provider, status, response, recall, admit, completed, accepted, applyStimulus, offerIntent,
    beginThinking, endThinking, setBehaviorContext, publish, chatMotion, quietSupport, getCharacterSnapshot,
    command, send, setSleep, success, settle, reload, beginInteraction, commitInteraction };
}
afterEach(() => vi.useRealTimers());

it.each([['ru', 'Wisp спит'], ['en', 'Wisp is sleeping']])('rejects sleeping sends before effects, consumes sequence and allows reset (%s)', (locale, message) => {
  const f = fixture('admission', locale); f.setSleep('sleeping', false);
  expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: false, submissionMessage: message, turn: { phase: 'idle' } });
  const command = f.command();
  expect(f.runtime.receive(command)).toEqual({ status: 'rejected', reason: 'unavailable' });
  expect(f.runtime.receive(command)).toEqual({ status: 'rejected', reason: 'stale' });
  expect(f.send('иди влево')).toEqual({ status: 'rejected', reason: 'unavailable' });
  expect(f.send('побудь рядом')).toEqual({ status: 'rejected', reason: 'unavailable' });
  expect(f.accepted).not.toHaveBeenCalled(); expect(f.applyStimulus).not.toHaveBeenCalled();
  expect(f.admit).not.toHaveBeenCalled(); expect(f.provider.getStatus).not.toHaveBeenCalled();
  expect(f.chatMotion.submit).not.toHaveBeenCalled(); expect(f.quietSupport.enter).not.toHaveBeenCalled();
  expect(f.quietSupport.resumeForUserDialogue).not.toHaveBeenCalled(); expect(f.completed).not.toHaveBeenCalled();
  const { text: _text, ...reset } = f.command();
  expect(f.runtime.receive({ ...reset, type: 'reset' })).toMatchObject({ status: 'accepted' });
  expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: false, submissionMessage: message });
  f.runtime.detachStream(); expect(f.runtime.getPresentation()).not.toHaveProperty('submissionMessage');
  f.runtime.dispose(); expect(f.runtime.getPresentation()).not.toHaveProperty('submissionMessage');
});

it('does not infer awake from unavailable state, or sleep from sleepy tone', async () => {
  const f = fixture(); f.setSleep('unavailable', false);
  expect(f.runtime.getPresentation().canSubmit).toBe(false);
  expect(f.send()).toEqual({ status: 'rejected', reason: 'unavailable' });
  expect(f.provider.getStatus).not.toHaveBeenCalled();
  f.setSleep('awake');
  f.getCharacterSnapshot.mockReturnValue({ ...new CharacterStateService().getSnapshot(), synthesizedTone: 'sleepy' });
  expect(f.send().status).toBe('accepted'); await flush();
  f.response.resolve(f.success()); await flush();
  expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: true, turn: { phase: 'completed', outcome: { kind: 'success' } } });
  expect(f.completed).toHaveBeenCalledOnce();
});

it.each<Stage>(['status', 'recall', 'admission', 'response'])('invalidates %s synchronously and preserves its guard across sleep/wake until settlement', async stage => {
  const f = fixture(stage); expect(f.send().status).toBe('accepted'); await flush();
  const conversationId = f.runtime.getPresentation().conversationId;
  f.setSleep('sleeping');
  expect(f.runtime.getPresentation()).toMatchObject({ conversationId, canSubmit: false, submissionMessage: 'Wisp спит', turn: { phase: 'idle' } });
  f.setSleep('awake');
  expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: false, turn: { phase: 'idle' } });
  expect(f.send()).toEqual({ status: 'rejected', reason: 'busy' });
  f.settle(); await flush();
  expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: true, turn: { phase: 'idle' } });
  expect(f.completed).not.toHaveBeenCalled(); expect(f.offerIntent).not.toHaveBeenCalled();
  expect(f.applyStimulus.mock.calls.filter(([stimulus]) => stimulus.type === 'provider_response')).toHaveLength(0);
  expect(f.accepted).toHaveBeenCalledOnce();
  if (stage !== 'response') expect(f.provider.generateResponse).not.toHaveBeenCalled();
  if (stage !== 'admission') {
    expect(f.endThinking).toHaveBeenCalledExactlyOnceWith(f.beginThinking.mock.calls[0]![0]);
    expect(f.setBehaviorContext.mock.calls.filter(([value]) => value === null)).toHaveLength(2); // initial bind and cancellation
  }
  f.runtime.dispose();
});

it.each(['success', 'rejection', 'timeout', 'reset', 'reload', 'dispose'])('drops a retired provider result after sleep and %s without duplicate cleanup', async action => {
  const f = fixture(); f.send(); await flush();
  const success = f.success(); f.setSleep('sleeping'); f.setSleep('awake');
  if (action === 'timeout') vi.advanceTimersByTime(15000);
  if (action === 'reset') { const { text: _text, ...reset } = f.command(); f.runtime.receive({ ...reset, type: 'reset' }); }
  if (action === 'reload') f.reload();
  if (action === 'dispose') f.runtime.dispose();
  expect(f.runtime.getPresentation().canSubmit).toBe(false);
  if (action === 'rejection') f.response.reject(new Error('private provider failure')); else f.response.resolve(success);
  await flush();
  expect(f.runtime.getPresentation().turn).toEqual({ phase: 'idle' });
  expect(f.runtime.getPresentation().canSubmit).toBe(action !== 'dispose');
  expect(f.provider.cancel).toHaveBeenCalledExactlyOnceWith(success.requestId);
  expect(f.endThinking).toHaveBeenCalledExactlyOnceWith(success.requestId);
  expect(f.completed).not.toHaveBeenCalled(); expect(f.offerIntent).not.toHaveBeenCalled();
  expect(f.applyStimulus).toHaveBeenCalledTimes(1);
});

it('keeps completed context but excludes the cancelled pair from the next request', async () => {
  const f = fixture();
  f.provider.generateResponse.mockImplementationOnce(async request => ({ requestId: request.requestId, status: 'ok', confidence: 1, reply: { text: 'Первый ответ' } }));
  f.send('Первый вопрос'); await flush();
  expect(f.completed).toHaveBeenCalledOnce();
  f.send('Отменённый вопрос'); await flush();
  const oldResponse = f.success(); f.setSleep('sleeping'); f.setSleep('awake');
  f.response.resolve(oldResponse); await flush();
  const next = deferred<AIProviderResponse>(); f.provider.generateResponse.mockReturnValue(next.promise);
  f.send('Новый вопрос'); await flush();
  expect(f.provider.generateResponse.mock.calls.at(-1)![0].recentContext.map(message => message.text)).toEqual(['Первый вопрос', 'Первый ответ']);
  expect(f.completed).toHaveBeenCalledOnce(); f.runtime.dispose();
  next.resolve(f.success()); await flush();
});

it('checks current sleep state again after provider await even before notification', async () => {
  const f = fixture(); f.send(); await flush(); f.setSleep('sleeping', false);
  f.response.resolve(f.success()); await flush();
  expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: false, turn: { phase: 'idle' } });
  expect(f.completed).not.toHaveBeenCalled(); expect(f.offerIntent).not.toHaveBeenCalled();
});


it('preserves the accepted user effect but never commits a retired appraisal', async () => {
  const f = fixture('response', 'ru', true); f.send(); await flush();
  expect(f.beginInteraction).toHaveBeenCalledOnce();
  const response: AIProviderResponse = { ...f.success(), appraisal: { category: 'supportive', intensity: 'moderate', confidence: 'clear' } };
  f.setSleep('sleeping'); f.setSleep('awake'); f.response.resolve(response); await flush();
  expect(f.beginInteraction).toHaveBeenCalledOnce(); expect(f.commitInteraction).not.toHaveBeenCalled();
  expect(f.completed).not.toHaveBeenCalled(); expect(f.offerIntent).not.toHaveBeenCalled();
});

it.each<Stage>(['admission', 'recall'])('retains the retired %s guard beyond its storage deadline and reset until actual settlement', async stage => {
  const f = fixture(stage); f.send(); await flush(); f.setSleep('sleeping'); f.setSleep('awake');
  await vi.advanceTimersByTimeAsync(200);
  expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: false, turn: { phase: 'idle' } });
  const { text: _text, ...reset } = f.command(); f.runtime.receive({ ...reset, type: 'reset' });
  expect(f.send()).toEqual({ status: 'rejected', reason: 'busy' });
  f.settle(); await flush();
  expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: true, turn: { phase: 'idle' } });
  expect(f.provider.generateResponse).not.toHaveBeenCalled(); expect(f.completed).not.toHaveBeenCalled();
});

it('keeps sleep cancellation and publication effective when optional adapter cancel throws', async () => {
  const f = fixture(); f.send(); await flush();
  const response = f.success();
  f.provider.cancel.mockImplementation(() => { throw new Error('adapter cancellation failure'); });
  f.publish.mockClear();
  expect(() => f.setSleep('sleeping')).not.toThrow();
  expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: false, submissionMessage: 'Wisp спит', turn: { phase: 'idle' } });
  expect(f.publish).toHaveBeenCalled();
  f.setSleep('awake'); expect(f.runtime.getPresentation().canSubmit).toBe(false);
  f.response.resolve(response); await flush();
  expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: true, turn: { phase: 'idle' } });
  expect(f.completed).not.toHaveBeenCalled(); expect(f.offerIntent).not.toHaveBeenCalled();
  expect(f.endThinking).toHaveBeenCalledExactlyOnceWith(response.requestId);
});
