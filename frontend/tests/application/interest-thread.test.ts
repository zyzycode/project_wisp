import { afterEach, expect, it, vi } from 'vitest';
import { InterestThreadDialogue, isTopicGreeting } from '../../src/application/services/interest-thread';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import type { IInterestThreadRepository, InterestThread, InterestThreadCapture } from '../../src/application/ports/interest-thread.interface';
import type { MemoryLifecycle } from '../../src/application/services/memory-lifecycle';
import type { AIProviderRequest, AIProviderResponse } from '../../src/application/ports/ai-provider.interface';
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; }
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const ref = { threadId: 'topic', revision: 2 };
const confirmedAt = '2026-10-20T00:00:00.000Z';
const thread: InterestThread = { ref, state: 'unanswered', text: 'сегодня собеседование', source: { userMessageId: 'u', assistantMessageId: 'a' }, statedAt: confirmedAt, confirmedAt, eligibleAt: '2026-10-21T00:00:00.000Z', expiresAt: '2026-10-27T00:00:00.000Z', attempt: null };
function capture(requestId: string, userMessageId: string): InterestThreadCapture { return { use: { ref, requestId, userMessageId, mode: 'follow_up' }, topic: { mode: 'follow_up', text: thread.text!, statedAt: confirmedAt }, expiresAt: thread.expiresAt, generation: 0 }; }
function fixture(summary?: import('../../src/application/ports/summary').ISummaryRuntime) {
  vi.useFakeTimers(); vi.setSystemTime('2026-10-22T00:00:00.000Z');
  let generation = 0, id = 0;
  const response = deferred<AIProviderResponse>();
  const read = vi.fn<IInterestThreadRepository['read']>(async () => ({ ok: true, value: { thread, sourceValid: true } }));
  const claim = vi.fn<IInterestThreadRepository['claim']>(async command => ({ ok: true, value: capture(command.requestId, command.userMessageId) }));
  const captureReply = vi.fn<IInterestThreadRepository['captureReply']>(async command => ({ ok: true, value: { ...capture(command.requestId, command.userMessageId), use: { ...capture(command.requestId, command.userMessageId).use, mode: 'reply' }, topic: { ...capture(command.requestId, command.userMessageId).topic, mode: 'reply' } } }));
  const repository: IInterestThreadRepository = { read, claim, captureReply, mutate: vi.fn() };
  let runtime: DialogueRuntime;
  const memory = { context: () => ({ generation }), currentGeneration: () => generation,
    mutateInterestThread: vi.fn<MemoryLifecycle['mutateInterestThread']>(async (_command, token) => { generation++; runtime.clearMemoryContext(token); return { ok: true, value: { commandId: 'closed', ref, outcome: 'closed' } }; }) } satisfies Pick<MemoryLifecycle, 'context' | 'currentGeneration' | 'mutateInterestThread'>;
  const notice = vi.fn();
  const topic = new InterestThreadDialogue({ runtime: () => memory, repository, now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `id-${++id}`, notice, isTurnCurrent: requestId => runtime.isTopicRequestCurrent(requestId), isAdmissionCurrent: token => runtime.isAdmissionCurrent(token) });
  const provider = { supportsDialogueTopic: true as const, getStatus: vi.fn(async () => ({ kind: 'ready' as const })), generateResponse: vi.fn((_request: AIProviderRequest) => response.promise) };
  const completed = vi.fn();
  runtime = new DialogueRuntime({ getSemanticSleepState: () => 'awake', provider, ...(summary ? { summary } : {}), memory: { interestThread: topic, generation: () => generation, completed }, now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `id-${++id}`,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }, getCharacterSnapshot: () => new CharacterStateService().getSnapshot(), applyStimulus: vi.fn(), beginThinking: vi.fn(), endThinking: vi.fn(), offerIntent: vi.fn(), transaction: fn => fn(), publish: vi.fn() });
  runtime.replaceStream('stream');
  const send = (text = 'Привет', replyToInterestThread?: typeof ref) => runtime.receive({ type: 'send', text, sequence: ++id, conversationId: runtime.getPresentation().conversationId, streamId: 'stream', ...(replyToInterestThread ? { replyToInterestThread } : {}) });
  const success = () => ({ requestId: provider.generateResponse.mock.calls[0]![0].requestId, status: 'ok' as const, reply: { text: 'Как сейчас дела с собеседованием?' }, confidence: 1 });
  return { runtime, topic, read, claim, captureReply, memory, provider, response, completed, notice, send, success, bump: () => { generation++; runtime.clearMemoryContext(); } };
}
afterEach(() => vi.useRealTimers());
it.each(['Привет!', 'hello.', 'how are you?', 'Добрый вечер'])('admits only exact greeting grammar %s', text => { expect(isTopicGreeting(text)).toBe(true); expect(isTopicGreeting(`${text} а ещё`)).toBe(false); });
it('claims before provider and suppresses offered pair from volatile context and marks trusted append binding', async () => {
  const f = fixture(); f.send(); await flush();
  expect(f.claim).toHaveBeenCalledTimes(1); expect(f.provider.generateResponse.mock.calls[0]![0].dialogueTopic).toMatchObject({ mode: 'follow_up' });
  f.response.resolve(f.success()); await flush();
  expect(f.completed).toHaveBeenCalledWith(expect.objectContaining({ interestThread: expect.objectContaining({ ref, mode: 'follow_up' }) }));
  expect(f.runtime.getPresentation().turn).toMatchObject({ phase: 'completed', interestThread: ref });
  f.read.mockResolvedValue({ ok: true, value: { thread: { ...thread, attempt: { requestId: 'old', userMessageId: 'old-u', attemptedAt: confirmedAt } }, sourceValid: true } });
  f.send('Расскажи историю'); await flush();
  expect(f.provider.generateResponse.mock.calls[1]![0].recentContext).toEqual([]); expect(f.claim).toHaveBeenCalledTimes(1);
});
it('does not claim on ordinary input, before 24h, backward clock or after expiry', async () => {
  const f = fixture();
  for (const [text, now] of [['Новости?', '2026-10-22'], ['Привет', '2026-10-20T12:00:00Z'], ['Привет', '2026-10-19']] as const) {
    vi.setSystemTime(now); const result = await f.topic.prepare({ text, requestId: 'r', userMessageId: 'u', deadlineMs: Date.now() + 200 }, { generation: 0 }); expect(result).toEqual({ ok: true, value: null });
  }
  expect(f.claim).not.toHaveBeenCalled();
});
it('uses explicit binding for reply, never text classification', async () => {
  const f = fixture(); f.send('его перенесли', ref); await flush();
  expect(f.captureReply).toHaveBeenCalledTimes(1); expect(f.claim).not.toHaveBeenCalled();
  expect(f.provider.generateResponse.mock.calls[0]![0].dialogueTopic?.mode).toBe('reply');
});
it('scoped refusal commits its own barrier and creates neither provider call nor pair', async () => {
  const f = fixture(); f.send('Не спрашивай', ref); await flush();
  expect(f.memory.mutateInterestThread).toHaveBeenCalledWith(expect.objectContaining({ reason: 'declined' }), expect.any(Object));
  expect(f.notice).toHaveBeenCalledTimes(1); expect(f.provider.generateResponse).not.toHaveBeenCalled(); expect(f.completed).not.toHaveBeenCalled(); expect(f.runtime.getPresentation().canSubmit).toBe(true);
});
it('own expiry barrier rebases only the pending input', async () => {
  const f = fixture(); vi.setSystemTime('2026-10-28T00:00:00Z'); f.send(); await flush();
  expect(f.memory.mutateInterestThread).toHaveBeenCalledWith(expect.objectContaining({ reason: 'expired' }), expect.any(Object));
  expect(f.provider.generateResponse).toHaveBeenCalledTimes(1); expect(f.provider.generateResponse.mock.calls[0]![0].dialogueTopic).toBeUndefined();
});
it.each(['reset', 'reload', 'dispose', 'delete'])('external %s cancels pending input and late read', async action => {
  const f = fixture(), pending = deferred<Awaited<ReturnType<IInterestThreadRepository['read']>>>(); f.read.mockReturnValue(pending.promise); f.send(); await flush();
  if (action === 'reset') f.runtime.receive({ type: 'reset', sequence: 100, streamId: 'stream', conversationId: f.runtime.getPresentation().conversationId });
  if (action === 'reload') f.runtime.replaceStream('new'); if (action === 'dispose') f.runtime.dispose(); if (action === 'delete') f.bump();
  pending.resolve({ ok: true, value: { thread, sourceValid: true } }); await flush(); expect(f.claim).not.toHaveBeenCalled(); expect(f.provider.generateResponse).not.toHaveBeenCalled();
});
it('drops whole response after in-flight expiry', async () => {
  const f = fixture(); f.send(); await flush(); vi.setSystemTime('2026-10-28T00:00:00Z'); f.response.resolve(f.success()); await flush();
  expect(f.runtime.getPresentation().turn).toMatchObject({ phase: 'completed', outcome: { kind: 'fallback' } });
});
it('times out one unsettled group at 200ms, sends baseline and never queues a second read or late claim', async () => {
  const f = fixture(), pending = deferred<Awaited<ReturnType<IInterestThreadRepository['read']>>>(); f.read.mockReturnValue(pending.promise); f.send(); await flush();
  await vi.advanceTimersByTimeAsync(200); await flush();
  expect(f.provider.generateResponse.mock.calls[0]![0].dialogueTopic).toBeUndefined(); f.response.resolve(f.success()); await flush(); f.send(); await flush();
  expect(f.read).toHaveBeenCalledTimes(1); pending.resolve({ ok: true, value: { thread, sourceValid: true } }); await flush(); expect(f.claim).not.toHaveBeenCalled();
});
it('does not spend claim allowance without provider capability', async () => {
  const f = fixture(); Object.assign(f.provider, { supportsDialogueTopic: undefined }); f.send(); await flush(); expect(f.claim).not.toHaveBeenCalled();
});
it.each(['reset', 'reload', 'dispose'])('late expired-source admission cannot mutate after %s', async action => {
  const f = fixture(), pending = deferred<Awaited<ReturnType<IInterestThreadRepository['read']>>>();
  vi.setSystemTime('2026-10-28T00:00:00Z'); f.read.mockReturnValueOnce(pending.promise); f.send(); await flush();
  if (action === 'reset') f.runtime.receive({ type: 'reset', streamId: 'stream', conversationId: f.runtime.getPresentation().conversationId, sequence: 1000 });
  if (action === 'reload') f.runtime.replaceStream('new'); if (action === 'dispose') f.runtime.dispose();
  pending.resolve({ ok: true, value: { thread, sourceValid: true } }); await flush();
  expect(f.memory.mutateInterestThread).not.toHaveBeenCalled(); expect(f.provider.generateResponse).not.toHaveBeenCalled();
});
it('Mock explicit reply uses authoritative local capture and suppresses pair without provider topic projection', async () => {
  const f = fixture(); Object.assign(f.provider, { supportsDialogueTopic: undefined }); f.send('My name is Alex', ref); await flush();
  expect(f.captureReply).toHaveBeenCalledTimes(1); expect(f.provider.generateResponse.mock.calls[0]![0].dialogueTopic).toBeUndefined();
  f.response.resolve(f.success()); await flush(); expect(f.completed).toHaveBeenCalledWith(expect.objectContaining({ interestThread: expect.objectContaining({ mode: 'reply' }) }));
  f.send('ещё'); await flush(); expect(f.provider.generateResponse.mock.calls[1]![0].recentContext).toEqual([]);
});
it.each(['timeout', 'stale', 'storage-error'])('bound reply without fresh capture fails safely on %s without provider, pair, generic fact source', async kind => {
  const f = fixture();
  if (kind === 'timeout') { const pending = deferred<Awaited<ReturnType<IInterestThreadRepository['read']>>>(); f.read.mockReturnValue(pending.promise); }
  if (kind === 'stale') f.captureReply.mockResolvedValue({ ok: true, value: null });
  if (kind === 'storage-error') f.captureReply.mockResolvedValue({ ok: false, code: 'io_error' });
  f.send('My name is Alex', ref); await flush(); if (kind === 'timeout') { await vi.advanceTimersByTimeAsync(200); await flush(); }
  expect(f.provider.generateResponse).not.toHaveBeenCalled(); expect(f.completed).not.toHaveBeenCalled(); expect(f.runtime.getPresentation().turn).toMatchObject({ phase: 'error' });
});

it('preflight and summary share one absolute200ms budget; late summary cannot start another topic read', async () => {
  const summary: import('../../src/application/ports/summary').ISummaryRuntime = { preview: vi.fn(), confirm: vi.fn(), deleteSummary: vi.fn(), capture: vi.fn<import('../../src/application/ports/summary').ISummaryRuntime['capture']>(() => new Promise(resolve => { setTimeout(() => resolve({ text: 'summary', excludedMessageIds: [], generation: 0 }), 100); })), isCurrent: () => true, interrupt: vi.fn(), invalidate: vi.fn(), reset: vi.fn(), dispose: vi.fn() };
  const f = fixture(summary);
  f.read.mockImplementationOnce(() => new Promise(resolve => { setTimeout(() => resolve({ ok: true, value: { thread, sourceValid: true } }), 150); }));
  f.send(); await flush(); await vi.advanceTimersByTimeAsync(199); expect(f.provider.generateResponse).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); await flush();
  expect(f.provider.generateResponse).toHaveBeenCalledTimes(1); expect(f.provider.generateResponse.mock.calls[0]![0]).not.toHaveProperty('summary'); expect(f.provider.generateResponse.mock.calls[0]![0]).not.toHaveProperty('dialogueTopic');
  await vi.advanceTimersByTimeAsync(100); await flush(); expect(f.read).toHaveBeenCalledTimes(1); expect(f.claim).not.toHaveBeenCalled();
});
it.each(['reset', 'reload', 'dispose'])('late prepare read cannot claim after dialogue %s without a memory generation change', async action => {
  const f = fixture(), pending = deferred<Awaited<ReturnType<IInterestThreadRepository['read']>>>();
  f.read.mockResolvedValueOnce({ ok: true, value: { thread, sourceValid: true } }).mockReturnValueOnce(pending.promise); f.send(); await flush(); expect(f.read).toHaveBeenCalledTimes(2);
  if (action === 'reset') f.runtime.receive({ type: 'reset', streamId: 'stream', conversationId: f.runtime.getPresentation().conversationId, sequence: 1000 });
  if (action === 'reload') f.runtime.replaceStream('new'); if (action === 'dispose') f.runtime.dispose();
  pending.resolve({ ok: true, value: { thread, sourceValid: true } }); await flush(); expect(f.claim).not.toHaveBeenCalled(); expect(f.provider.generateResponse).not.toHaveBeenCalled();
});
