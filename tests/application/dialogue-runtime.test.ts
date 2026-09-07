import { afterEach, expect, it, vi } from 'vitest';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import type { AIProviderRequest, AIProviderResponse, AIProviderStatus } from '../../src/application/ports/ai-provider.interface';
import * as validation from '../../src/shared/dialogue-ipc-validation';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture(statusPending = false) {
  vi.useFakeTimers(); vi.setSystemTime(0); let id = 0;
  const status = deferred<AIProviderStatus>(), response = deferred<AIProviderResponse>();
  const provider = { getStatus: vi.fn(() => statusPending ? status.promise : Promise.resolve({ kind: 'ready' as const })), generateResponse: vi.fn((_request: AIProviderRequest) => response.promise) };
  const applyStimulus = vi.fn(), offerIntent = vi.fn(), publish = vi.fn(), endThinking = vi.fn();
  const runtime = new DialogueRuntime({ provider, now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `id-${++id}`,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    getCharacterSnapshot: () => new CharacterStateService().getSnapshot(), applyStimulus, offerIntent, publish, beginThinking: vi.fn(), endThinking,
    transaction: commit => commit() });
  runtime.replaceStream('stream');
  const command = (sequence = 1) => ({ type: 'send' as const, text: 'Привет', sequence, streamId: 'stream', conversationId: runtime.getPresentation().conversationId });
  const success = (): AIProviderResponse => ({ requestId: provider.generateResponse.mock.calls[0]![0].requestId, status: 'ok', reply: { text: 'Привет!' }, confidence: 1 });
  return { runtime, provider, status, response, applyStimulus, offerIntent, publish, endThinking, command, success };
}
afterEach(() => vi.useRealTimers());
it('rejects malformed payloads before any provider call or semantic stimulus', async () => {
  const f = fixture();
  expect(f.runtime.receive({ ...f.command(), text: '\u0000' })).toEqual({ status: 'rejected', reason: 'invalid_input' });
  expect(f.runtime.receive({ ...f.command(), extra: true })).toEqual({ status: 'rejected', reason: 'invalid_input' });
  await flush(); expect(f.provider.getStatus).not.toHaveBeenCalled(); expect(f.applyStimulus).not.toHaveBeenCalled();
});
it('admits once, rejects duplicate and busy sequence without extra stimuli', async () => {
  const f = fixture(); expect(f.runtime.receive(f.command())).toMatchObject({ status: 'accepted' });
  expect(f.runtime.receive(f.command())).toEqual({ status: 'rejected', reason: 'stale' });
  expect(f.runtime.receive(f.command(2))).toEqual({ status: 'rejected', reason: 'busy' });
  await flush(); f.response.resolve(f.success()); await flush();
  expect(f.provider.generateResponse).toHaveBeenCalledTimes(1); expect(f.applyStimulus).toHaveBeenCalledTimes(2);
  expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: true, turn: { phase: 'completed', outcome: { kind: 'success' } } });
  expect(f.runtime.receive(f.command(2))).toEqual({ status: 'rejected', reason: 'stale' });
});
it.each([true, false])('times out either await stage and keeps its guard until settlement: %s', async pendingStatus => {
  const f = fixture(pendingStatus); f.runtime.receive(f.command()); await flush(); vi.advanceTimersByTime(15000);
  expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: false, turn: { phase: 'completed', outcome: { reason: 'timeout' } } });
  if (pendingStatus) f.status.resolve({ kind: 'ready' }); else f.response.resolve(f.success());
  await flush(); expect(f.runtime.getPresentation().canSubmit).toBe(true); expect(f.offerIntent).not.toHaveBeenCalled();
  expect(f.applyStimulus).toHaveBeenCalledTimes(1);
  if (pendingStatus) expect(f.provider.generateResponse).not.toHaveBeenCalled();
});
it.each(['reset', 'reload', 'dispose'])('ignores a late response after %s', async action => {
  const f = fixture(); f.runtime.receive(f.command()); await flush();
  if (action === 'reset') { const { text: _text, ...meta } = f.command(2); f.runtime.receive({ ...meta, type: 'reset' }); }
  if (action === 'reload') f.runtime.replaceStream('next');
  if (action === 'dispose') f.runtime.dispose();
  f.response.reject(new Error('private failure')); await flush(); expect(f.offerIntent).not.toHaveBeenCalled();
  expect(f.applyStimulus).toHaveBeenCalledTimes(1);
});

it.each([true, false])('retains the execution guard across stream replacement at either stage: %s', async statusPending => {
  const f = fixture(statusPending); f.runtime.receive(f.command()); await flush();
  f.runtime.replaceStream('next');
  const command = { ...f.command(), streamId: 'next' };
  expect(f.runtime.receive(command)).toEqual({ status: 'rejected', reason: 'busy' });
  if (statusPending) f.status.resolve({ kind: 'ready' }); else f.response.resolve(f.success());
  await flush(); expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: true, turn: { phase: 'idle' } });
  expect(f.offerIntent).not.toHaveBeenCalled();
  expect(f.runtime.receive({ ...command, sequence: 2 }).status).toBe('accepted');
  await flush();
});

it('publishes safe error without a partial context pair if terminal presentation fails', async () => {
  const f = fixture(); f.runtime.receive(f.command()); await flush();
  const original = validation.parseDialoguePresentation;
  const spy = vi.spyOn(validation, 'parseDialoguePresentation').mockImplementation(value => {
    if (typeof value === 'object' && value !== null && 'turn' in value
        && typeof value.turn === 'object' && value.turn !== null && 'phase' in value.turn && value.turn.phase === 'completed') throw new TypeError('failed fallback');
    return original(value);
  });
  try {
    f.response.reject(new Error('private')); await flush();
    expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: true, turn: { phase: 'error' } });
    expect(f.offerIntent).not.toHaveBeenCalled(); expect(f.applyStimulus).toHaveBeenCalledTimes(1);
  } finally { spy.mockRestore(); }
  f.runtime.receive(f.command(2)); await flush();
  expect(f.provider.generateResponse.mock.calls[1]![0].recentContext).toEqual([]);
});

it('offers explicit behavior with Main-owned request freshness metadata only after settlement', async () => {
  const f = fixture(); const conversationId = f.runtime.getPresentation().conversationId;
  f.runtime.receive(f.command()); await flush(); expect(f.offerIntent).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  const response = { ...f.success(), suggestedBehavior: 'wander' as const };
  f.response.resolve(response); await flush();
  expect(f.offerIntent).toHaveBeenCalledExactlyOnceWith({
    intent: expect.objectContaining({ kind: 'wander', source: 'provider', requestId: response.requestId }),
    conversationId, generation: 1, requestedAtMs: 0, receivedAtMs: 1000, expiresAtMs: 30000,
  });
});
it('keeps text-only success out of behavior admission', async () => {
  const f = fixture(); f.runtime.receive(f.command()); await flush(); f.response.resolve(f.success()); await flush();
  expect(f.runtime.getPresentation().turn.phase).toBe('completed'); expect(f.offerIntent).not.toHaveBeenCalled();
});
