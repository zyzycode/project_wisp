import { afterEach, expect, it, vi } from 'vitest';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { providerRequest } from '../infrastructure/backend-ai-fixture';
import type { IAIProvider } from '../../src/application/ports/ai-provider.interface';
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());
function fixture() {
  let release!: () => void, id = 0;
  const settled = new Promise<void>(resolve => { release = resolve; });
  const prior = { kind: 'social_bid' as const, text: 'Поговорим?', createdAt: '2026-09-18T00:00:00.000Z' };
  const events = { takePreviousInitiative: vi.fn(() => prior), interruptForUser: vi.fn(() => settled), invalidate: vi.fn() };
  const generateResponse = vi.fn<IAIProvider['generateResponse']>(async request => ({ requestId: request.requestId, status: 'ok', confidence: 1, reply: { text: 'Ответ' } }));
  const runtime = new DialogueRuntime({ provider: { getStatus: async () => ({ kind: 'ready' }), generateResponse }, events, now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `id${++id}`,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }, getCharacterSnapshot: () => providerRequest().characterSnapshot,
    applyStimulus: vi.fn(), beginThinking: vi.fn(), endThinking: vi.fn(), transaction: commit => commit(), publish: vi.fn(), offerIntent: vi.fn() });
  runtime.replaceStream('s');
  const send = (sequence: number) => runtime.receive({ type: 'send', sequence, text: 'да', streamId: 's', conversationId: runtime.getPresentation().conversationId });
  return { runtime, events, generateResponse, prior, send, release };
}
it('captures the preceding line on admission before interrupting; busy/invalid commands do not consume it', async () => {
  const f = fixture(); expect(f.runtime.receive({})).toEqual({ status: 'rejected', reason: 'invalid_input' }); expect(f.events.takePreviousInitiative).not.toHaveBeenCalled();
  expect(f.send(1).status).toBe('accepted'); expect(f.events.takePreviousInitiative).toHaveBeenCalledTimes(1);
  expect(f.send(2)).toEqual({ status: 'rejected', reason: 'busy' }); await flush(); expect(f.generateResponse).not.toHaveBeenCalled();
  f.release(); await flush(); expect(f.generateResponse).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ previousInitiative: f.prior, userMessage: expect.objectContaining({ text: 'да' }), recentContext: [] }));
  expect(f.events.takePreviousInitiative).toHaveBeenCalledTimes(1); f.runtime.dispose();
});
it.each(['reset', 'reload', 'dispose', 'deadline'])('never starts a user fetch after handoff if the turn was retired by%s', async action => {
  vi.useFakeTimers(); vi.setSystemTime(0); const f = fixture(); f.send(1); await flush();
  if (action === 'reset') f.runtime.receive({ type: 'reset', sequence: 2, streamId: 's', conversationId: f.runtime.getPresentation().conversationId });
  if (action === 'reload') f.runtime.replaceStream('new'); if (action === 'dispose') f.runtime.dispose(); if (action === 'deadline') await vi.advanceTimersByTimeAsync(15000);
  f.release(); await flush(); expect(f.generateResponse).not.toHaveBeenCalled(); f.runtime.dispose();
});
