import { expect, it, vi } from 'vitest';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import type { AIProviderRequest, AIProviderResponse } from '../../src/application/ports/ai-provider.interface';
import { scenario } from './autonomy-scenario-fixture';

it('notifies semantic sleep before presentation and preserves immediate sleep-wake transitions', () => {
  const order: string[] = [];
  const f = scenario({}, .2, undefined, undefined, {
    onSleepStateChanged: () => order.push(f.main.getSemanticSleepState()),
    onPresentationChanged: () => order.push('presentation'),
  });
  expect(f.main.getSemanticSleepState()).toBe('awake');
  expect(f.main.requestSleepWake({ action: 'sleep' })).toBe(true);
  expect(order[0]).toBe('sleeping');
  expect(f.main.getSemanticSleepState()).toBe('sleeping');
  order.length = 0;
  expect(f.main.requestSleepWake({ action: 'wake' })).toBe(true);
  expect(order[0]).toBe('awake');
  expect(f.main.getSemanticSleepState()).toBe('awake');
  f.main.dispose();
  expect(f.main.getSemanticSleepState()).toBe('unavailable');
});

it('observes autonomous vital sleep independently of recovery animation', () => {
  const states: string[] = [];
  const f = scenario({ energy: 0 }, .2, undefined, undefined, {
    onSleepStateChanged: () => states.push(f.main.getSemanticSleepState()),
  });
  f.advance(1);
  expect(states).toContain('sleeping');
  expect(f.main.getSemanticSleepState()).toBe('sleeping');
  f.main.beginDrag();
  expect(states.at(-1)).toBe('awake');
  f.main.dispose();
});

it('invalidates real Main dialogue before sleep publication, retaining the physical call guard through wake', async () => {
  let dialogue: DialogueRuntime | undefined;
  const observed: boolean[] = [];
  const f = scenario({}, .2, undefined, undefined, {
    onSleepStateChanged: () => dialogue?.notifySleepStateChanged(),
    onPresentationChanged: () => {
      if (dialogue && f.main.getSemanticSleepState() === 'sleeping') observed.push(dialogue.getPresentation().turn.phase === 'idle');
    },
  });
  let resolve!: (response: AIProviderResponse) => void;
  const response = new Promise<AIProviderResponse>(done => { resolve = done; });
  const provider = { getStatus: async () => ({ kind: 'ready' as const }),
    generateResponse: vi.fn((_request: AIProviderRequest) => response), cancel: vi.fn() };
  let id = 0;
  const completed = vi.fn(), effect = vi.fn(), endThinking = vi.fn();
  dialogue = new DialogueRuntime({ provider, getSemanticSleepState: () => f.main.getSemanticSleepState(),
    getCharacterSnapshot: () => f.character.getSnapshot(), now: f.now, timestamp: () => new Date(0).toISOString(),
    createId: () => `id-${++id}`, scheduler: { setTimeout: () => 1, clearTimeout: () => undefined },
    applyStimulus: effect, offerIntent: vi.fn(), beginThinking: vi.fn(), endThinking,
    transaction: commit => commit(), publish: vi.fn(), memory: { generation: () => 0, completed } });
  dialogue.replaceStream('stream');
  const command = () => ({ type: 'send', text: 'Привет', sequence: 1, streamId: 'stream', conversationId: dialogue!.getPresentation().conversationId });
  expect(dialogue.receive(command()).status).toBe('accepted');
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(provider.generateResponse).toHaveBeenCalledOnce();
  f.main.requestSleepWake({ action: 'sleep' });
  expect(dialogue.getPresentation()).toMatchObject({ canSubmit: false, submissionMessage: 'Wisp спит', turn: { phase: 'idle' } });
  expect(observed.length).toBeGreaterThan(0);
  expect(observed.every(Boolean)).toBe(true);
  expect(endThinking).toHaveBeenCalledOnce();
  expect(provider.cancel).toHaveBeenCalledOnce();
  f.main.requestSleepWake({ action: 'wake' });
  expect(dialogue.getPresentation().canSubmit).toBe(false);
  resolve({ requestId: provider.generateResponse.mock.calls[0]![0].requestId, status: 'ok', reply: { text: 'Поздний ответ' }, confidence: 1 });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(dialogue.getPresentation()).toMatchObject({ canSubmit: true, turn: { phase: 'idle' } });
  expect(completed).not.toHaveBeenCalled();
  expect(effect).toHaveBeenCalledOnce();
  expect(endThinking).toHaveBeenCalledOnce();
  dialogue.dispose(); f.main.dispose();
});
