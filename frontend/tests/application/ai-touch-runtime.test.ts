import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AIEventRuntime } from '../../src/application/services/ai-event-runtime';
import type { IAIEventProvider } from '../../src/application/ports/ai-event-provider.interface';
import { providerRequest } from '../infrastructure/backend-ai-fixture';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture(random = 0) {
  let id = 0, generation = 0, allowed = true;

  const generateEvent = vi.fn<IAIEventProvider['generateEvent']>(async request => {
    return { requestId: request.requestId, replyText: 'Щекотно!' };
  });
  const cancel = vi.fn(), publish = vi.fn(), recall = vi.fn();
  const runtime = new AIEventRuntime({ provider: { generateEvent, cancel }, recall: { recall }, random: () => random,
    autonomousEnabled: false, now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `r${++id}`,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    character: () => providerRequest().characterSnapshot, publish,
    gate: () => ({ allowed, identity: 's:c:0', memoryGeneration: generation, activeRunId: null, localSpeech: false }) });
  return { runtime, generateEvent, cancel, publish, recall, resetMemory: () => { generation++; }, block: () => { allowed = false; runtime.tick(); } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => vi.useRealTimers());

it.each([[0, 'stroke'], [.25, 'touch'], [.5, 'ruffle'], [.99, 'poke']] as const)('selects variant at %s without autonomous startup delay or memory recall', async (random, variant) => {
  const f = fixture(random); f.runtime.touch(); await flush();
  expect(f.generateEvent).toHaveBeenCalledTimes(1);
  expect(f.generateEvent.mock.calls[0]?.[0].event).toMatchObject({ type: 'user_touch', variant });
  expect(f.recall).not.toHaveBeenCalled(); expect(f.runtime.getSpeech()?.text).toBe('Щекотно!');
  expect(f.runtime.takePreviousInitiative()).toBeUndefined();
  f.runtime.dispose();
});
it('ignores repeat clicks while pending and has no queued sends', async () => {
  const f = fixture(); let resolve!: (value: { requestId: string; replyText: string }) => void;
  f.generateEvent.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
  f.runtime.touch(); f.runtime.touch(); await flush(); f.runtime.touch();
  expect(f.runtime.isTouchPending()).toBe(true); expect(f.generateEvent).toHaveBeenCalledTimes(1);
  f.runtime.activityStarted(); resolve({ requestId: 'r2', replyText: 'Ответ' }); await flush();
  expect(f.runtime.getSpeech()?.text).toBe('Ответ'); expect(f.cancel).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2000); expect(f.runtime.getSpeech()).toBeNull();
  expect(f.generateEvent).toHaveBeenCalledTimes(1); f.runtime.dispose();
});
it.each(['reset', 'dispose', 'memory', 'drag', 'dialogue', 'timeout'] as const)('discards late touch speech after %s', async action => {
  const f = fixture(); let resolve!: (value: { requestId: string; replyText: string }) => void;
  f.generateEvent.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
  f.runtime.touch(); await flush();
  if (action === 'reset') f.runtime.invalidate();
  if (action === 'dispose') f.runtime.dispose();
  if (action === 'memory') f.resetMemory();
  if (action === 'drag') f.block();
  if (action === 'dialogue') f.runtime.observeDialogue({ conversationId: 'c', canSubmit: false, turn: { phase: 'thinking', requestId: 'chat' } });
  if (action === 'timeout') await vi.advanceTimersByTimeAsync(15000);
  resolve({ requestId: 'r2', replyText: 'Поздно' }); await flush();
  expect(f.runtime.getSpeech()).toBeNull(); f.runtime.dispose();
});
it('keeps failures silent and permits subsequent touches beyond former quotas', async () => {
  const f = fixture(); f.generateEvent.mockRejectedValueOnce(new Error('offline'));
  f.runtime.touch(); await flush(); expect(f.runtime.getSpeech()).toBeNull();
  for (let i = 0; i < 105; i++) { f.runtime.touch(); await flush(); }
  expect(f.generateEvent).toHaveBeenCalledTimes(106); f.runtime.dispose();
});
