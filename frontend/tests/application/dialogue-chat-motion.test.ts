import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AIProviderRequest, AIProviderResponse } from '../../src/application/ports/ai-provider.interface';
import type { ChatMotionRequest, ChatMotionReceipt, ChatMotionCancellation } from '../../src/application/ports/chat-motion';
import type { CompletedDialogueMemoryTurn } from '../../src/application/ports/memory-runtime';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture(withMotion = true) {
  vi.useFakeTimers(); vi.setSystemTime(0);
  let id = 0, run = 0;
  let settle!: (response: AIProviderResponse) => void;
  const response = new Promise<AIProviderResponse>(resolve => { settle = resolve; });
  const provider = { getStatus: vi.fn(async () => ({ kind: 'ready' as const })),
    generateResponse: vi.fn((_request: AIProviderRequest) => response) };
  const motion = {
    submit: vi.fn((request: ChatMotionRequest): ChatMotionReceipt => request.command.kind === 'stop'
      ? { status: 'stopped', requestId: request.requestId, hadActiveRun: run > 0 }
      : { status: 'started', requestId: request.requestId, runId: `run-${++run}` }),
    cancel: vi.fn((_reason: ChatMotionCancellation) => {}),
  };
  const applyStimulus = vi.fn(), completed = vi.fn((_turn: CompletedDialogueMemoryTurn) => {});
  const offerIntent = vi.fn(() => ({ status: 'rejected' as const, reason: 'disabled' as const }));
  const runtime = new DialogueRuntime({ provider, ...(withMotion ? { chatMotion: motion } : {}),
    now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `id-${++id}`,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    getCharacterSnapshot: () => new CharacterStateService().getSnapshot(), applyStimulus, offerIntent,
    publish: vi.fn(), beginThinking: vi.fn(), endThinking: vi.fn(), transaction: commit => commit(),
    memory: { generation: () => 7, completed } });
  runtime.replaceStream('stream'); motion.cancel.mockClear();
  const command = (text: string, sequence = 1) => ({ type: 'send' as const, text, sequence,
    streamId: 'stream', conversationId: runtime.getPresentation().conversationId });
  const started = () => {
    const request = motion.submit.mock.calls[0]![0];
    return { status: 'completed' as const, requestId: request.requestId, runId: 'run-1' };
  };
  return { runtime, provider, motion, applyStimulus, completed, offerIntent, command, started, settle };
}
afterEach(() => vi.useRealTimers());

describe('DialogueRuntime local ChatMotion turns', () => {
  it.each(['иди влево', 'please walk left', 'иди туда'])('handles %s without any provider call and applies stimulus once', async text => {
    const f = fixture();
    expect(f.runtime.receive(f.command(text))).toMatchObject({ status: 'accepted' });
    await flush();
    expect(f.provider.getStatus).not.toHaveBeenCalled(); expect(f.provider.generateResponse).not.toHaveBeenCalled();
    expect(f.applyStimulus).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'user_message', text }));
    expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: true, turn: { phase: 'completed', outcome: { kind: 'local', reason: 'chat_motion' } } });
    if (text === 'иди туда') { expect(f.motion.submit).not.toHaveBeenCalled(); expect(f.motion.cancel).toHaveBeenCalledWith('user_input'); }
  });

  it('allows stop immediately after started and does not run provider', async () => {
    const f = fixture(); f.runtime.receive(f.command('иди влево'));
    expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: true, turn: { replyText: 'Иду влево.' } });
    expect(f.runtime.receive(f.command('стой', 2))).toMatchObject({ status: 'accepted' });
    expect(f.motion.submit.mock.calls.map(([request]) => request.command)).toEqual([{ kind: 'move', direction: 'left' }, { kind: 'stop' }]);
    expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: true, turn: { replyText: 'Остановилась.' } });
    await flush(); expect(f.provider.getStatus).not.toHaveBeenCalled(); expect(f.applyStimulus).toHaveBeenCalledTimes(2);
  });

  it('uses state refusal receipts rather than claiming the walk started', () => {
    const f = fixture(); f.motion.submit.mockImplementation(request => ({ status: 'rejected', requestId: request.requestId, reason: 'low_energy' }));
    f.runtime.receive(f.command('иди вправо'));
    expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: true, turn: { replyText: 'Я устала, мне нужно отдохнуть.' } });
  });

  it('does not claim it stopped physical motion when no chat run exists', () => {
    const f = fixture(); f.runtime.receive(f.command('стой'));
    expect(f.runtime.getPresentation()).toMatchObject({ turn: { replyText: 'Сейчас я не выполняю просьбу о движении.' } });
  });

  it('gives unavailable acknowledgement when the movement adapter is absent', async () => {
    const f = fixture(false); f.runtime.receive(f.command('иди влево')); await flush();
    expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: true, turn: { replyText: 'Сейчас движение недоступно.' } });
    expect(f.provider.getStatus).not.toHaveBeenCalled();
  });

  it('cancels on ordinary accepted input but stale and busy requests do not cancel again', async () => {
    const f = fixture(); f.runtime.receive(f.command('иди влево'));
    expect(f.runtime.receive(f.command('стой'))).toEqual({ status: 'rejected', reason: 'stale' });
    expect(f.motion.cancel).not.toHaveBeenCalled();
    f.runtime.receive(f.command('Привет', 2));
    expect(f.motion.cancel).toHaveBeenCalledExactlyOnceWith('user_input');
    expect(f.runtime.receive(f.command('стой', 3))).toEqual({ status: 'rejected', reason: 'busy' });
    expect(f.motion.cancel).toHaveBeenCalledTimes(1); expect(f.motion.submit).toHaveBeenCalledTimes(1);
    await flush(); expect(f.provider.generateResponse).toHaveBeenCalledOnce();
  });

  it('updates only its own started run once and does not persist a second pair', () => {
    const f = fixture(); f.runtime.receive(f.command('иди влево')); const terminal = f.started();
    f.runtime.chatMotionTerminal({ ...terminal, runId: 'other-run' });
    expect(f.runtime.getPresentation()).toMatchObject({ turn: { replyText: 'Иду влево.' } });
    f.runtime.chatMotionTerminal(terminal);
    expect(f.runtime.getPresentation()).toMatchObject({ turn: { replyText: 'Закончила прогулку.' } });
    const after = f.runtime.getPresentation();
    f.runtime.chatMotionTerminal({ ...terminal, status: 'cancelled', reason: 'timeout' });
    expect(f.runtime.getPresentation()).toEqual(after);
    expect(f.completed).toHaveBeenCalledOnce(); expect(f.applyStimulus).toHaveBeenCalledOnce();
  });

  it('reports critical need cancellation without a false completion', () => {
    const f = fixture(); f.runtime.receive(f.command('иди влево'));
    f.runtime.chatMotionTerminal({ ...f.started(), status: 'cancelled', reason: 'critical_need' });
    expect(f.runtime.getPresentation()).toMatchObject({ turn: { replyText: 'Остановилась: мне нужно отдохнуть.' } });
  });

  it.each(['replacement', 'ordinary', 'reset', 'reload', 'dispose'] as const)('ignores old terminal after %s', action => {
    const f = fixture(); f.runtime.receive(f.command('иди влево')); const terminal = f.started();
    if (action === 'replacement') f.runtime.receive(f.command('иди вправо', 2));
    if (action === 'ordinary') f.runtime.receive(f.command('Привет', 2));
    if (action === 'reset') f.runtime.receive({ type: 'reset', sequence: 2, streamId: 'stream', conversationId: f.runtime.getPresentation().conversationId });
    if (action === 'reload') f.runtime.replaceStream('next');
    if (action === 'dispose') f.runtime.dispose();
    const after = f.runtime.getPresentation(); f.runtime.chatMotionTerminal(terminal);
    expect(f.runtime.getPresentation()).toEqual(after);
    if (action === 'reset' || action === 'reload' || action === 'dispose') expect(f.motion.cancel).toHaveBeenCalledWith('reset');
  });

  it('stores local history without creating a confirmable memory source', () => {
    const f = fixture(); f.runtime.receive(f.command('иди влево'));
    expect(f.completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ localOnly: true, memoryConfirmable: false, memoryGeneration: 7 }));
    const pair = f.completed.mock.calls[0]![0];
    expect(f.runtime.confirmableSource({ userMessageId: pair.user.id, assistantMessageId: pair.assistant.id }, f.runtime.getPresentation().conversationId)).toBeNull();
  });

  it('does not execute model prose or a late suggested behavior as a chat command', async () => {
    const f = fixture(); f.runtime.receive(f.command('Привет')); await flush();
    const request = f.provider.generateResponse.mock.calls[0]![0];
    f.runtime.receive({ type: 'reset', sequence: 2, streamId: 'stream', conversationId: f.runtime.getPresentation().conversationId });
    f.settle({ requestId: request.requestId, status: 'ok', reply: { text: 'Иду влево.' }, confidence: 1, suggestedBehavior: 'wander' });
    await flush();
    expect(f.motion.submit).not.toHaveBeenCalled(); expect(f.offerIntent).not.toHaveBeenCalled();
    expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: true, turn: { phase: 'idle' } });
  });
});
