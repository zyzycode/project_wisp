import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AIEventRuntime } from '../../src/application/services/ai-event-runtime';
import { emptyMemoryContext } from '../../src/application/services/memory-recall';
import { providerRequest } from '../infrastructure/backend-ai-fixture';
import type { IAIEventProvider } from '../../src/application/ports/ai-event-provider.interface';
import type { ILocalMemoryRecall } from '../../src/application/ports/memory-knowledge.interface';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture() {
  let activeRunId: string | null = null, allowed = true, identity: string | null = 'stream:c:0', generation = 0, localSpeech = false;
  let id = 0;
  const generateEvent = vi.fn<IAIEventProvider['generateEvent']>(async request => {
    return { requestId: request.requestId, replyText: 'Помнишь нашу игру?' };
  });
  const cancel = vi.fn(), publish = vi.fn();
  const recall = vi.fn<ILocalMemoryRecall['recall']>(async () => ({ ok: true, value: emptyMemoryContext() }));
  const runtime = new AIEventRuntime({ provider: { generateEvent, cancel }, recall: { recall }, now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `r${++id}`,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }, character: () => providerRequest().characterSnapshot,
    gate: () => ({ allowed, activeRunId, identity, memoryGeneration: generation, localSpeech }), publish });
  function game(runId = 'game', status: 'completed' | 'cancelled' | 'failed' = 'completed', ack = true) {
    runtime.gameTerminal({ activityRunId: runId, atMs: Date.now(), outcome: 'caught', playCompleted: true, executedMs: 2800 }, generation);
    runtime.outcome({ type: 'activity_outcome', eventId: runId, activityRunId: runId, atMs: Date.now(), family: 'cursor_interest', outcome: status, participation: 'solitary', executedMs: 2800, playCompleted: true });
    const episode = { appRunId: 'app', activityRunId: runId, kind: 'cursor_game' as const, outcome: 'caught' as const, playCompleted: true as const, executedMs: 2800, endedAt: new Date().toISOString() };
    if (ack) runtime.committed(episode, { generation }); return episode;
  }
  const social = (runId: string) => { runtime.activityStarted(); activeRunId = runId; runtime.socialStarted(runId, Date.now()); };
  const socialEnd = (runId: string, outcome: 'completed' | 'cancelled' | 'failed' = 'completed') => { activeRunId = null; runtime.outcome({ type: 'activity_outcome', eventId: runId, activityRunId: runId, atMs: Date.now(), family: 'social_bid', outcome, participation: 'solitary', executedMs: 4000, playCompleted: false }); };
  return { runtime, generateEvent, recall, publish, cancel, game, social, socialEnd, block: () => { allowed = false; runtime.tick(); }, generation: () => { generation++; }, localSpeech: () => { localSpeech = true; }, reset: () => { identity = 'next:c:1'; runtime.invalidate(); } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(300000); });
afterEach(() => vi.useRealTimers());
it('requires real completed terminal plus durable commit, delays exactly2s and dedupes no-op commits after expiry', async () => {
  const f = fixture(), episode = f.game();
  await vi.advanceTimersByTimeAsync(1999); expect(f.generateEvent).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(f.generateEvent).toHaveBeenCalledTimes(1); expect(f.runtime.getSpeech()?.text).toBe('Помнишь нашу игру?');
  expect(f.generateEvent.mock.calls[0]?.[0]).toMatchObject({ event: { type: 'cursor_game_completed', outcome: 'caught', executedMs: 2800 } });
  await vi.advanceTimersByTimeAsync(2000); expect(f.runtime.getSpeech()).toBeNull();
  f.runtime.committed(episode, { generation: 0 }); await vi.advanceTimersByTimeAsync(3600000); expect(f.generateEvent).toHaveBeenCalledTimes(1);
});
it.each(['cancelled', 'failed'] as const)('does not infer completed from caught/playCompleted if Activity is%s', async status => { const f = fixture(); f.game('g', status); await vi.advanceTimersByTimeAsync(3000); expect(f.generateEvent).not.toHaveBeenCalled(); });
it('does not send after absent/late persistence acknowledgement or a new conflicting activity', async () => {
  const f = fixture(), episode = f.game('late', 'completed', false); await vi.advanceTimersByTimeAsync(2000); f.runtime.committed(episode, { generation: 0 }); await flush(); expect(f.generateEvent).not.toHaveBeenCalled();
  f.game('conflict'); f.runtime.activityStarted(); await vi.advanceTimersByTimeAsync(2000); expect(f.generateEvent).not.toHaveBeenCalled();
});
it('drops a delayed causal timer at2500ms instead of catching up', async () => {
  const f = fixture(); f.game(); vi.setSystemTime(302500); await vi.runOnlyPendingTimersAsync(); expect(f.generateEvent).not.toHaveBeenCalled();
});
it('binds SocialBid speech to the real current run and preserves previous initiative after its normal terminal', async () => {
  const f = fixture(); f.social('s'); await flush(); expect(f.runtime.getSpeech()).not.toBeNull();
  expect(f.recall).toHaveBeenCalledWith(expect.objectContaining({ useFavoriteTopic: true, text: '' }), { generation: 0 });
  f.socialEnd('s'); expect(f.runtime.getSpeech()).toBeNull();
  expect(f.runtime.takePreviousInitiative()).toMatchObject({ kind: 'social_bid', text: 'Помнишь нашу игру?' });
  expect(f.runtime.takePreviousInitiative()).toBeUndefined();
});
it.each(['terminal', 'quiet', 'reset', 'memory', 'dispose', 'speech'])('discards event after awaiting provider if%s changed', async action => {
  const f = fixture(); let resolve!: (value: { requestId: string; replyText: string }) => void;
  f.generateEvent.mockImplementationOnce(() => new Promise(yes => { resolve = yes; })); f.social('s'); await flush();
  if (action === 'terminal') f.socialEnd('s'); if (action === 'quiet') f.block(); if (action === 'reset') f.reset(); if (action === 'memory') f.generation(); if (action === 'dispose') f.runtime.dispose(); if (action === 'speech') f.localSpeech();
  resolve({ requestId: 'r1', replyText: 'Поздно' }); await flush(); expect(f.runtime.getSpeech()).toBeNull();
});
it('invalidates a recall before sending and expires previousInitiative at60s', async () => {
  const f = fixture(); let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
  f.recall.mockImplementationOnce(async () => { await wait; return { ok: true, value: emptyMemoryContext() }; }); f.social('s'); f.block(); release(); await flush(); expect(f.generateEvent).not.toHaveBeenCalled();
  const g = fixture(); g.social('s'); await flush(); await vi.advanceTimersByTimeAsync(60000); expect(g.runtime.takePreviousInitiative()).toBeUndefined();
});
it('allows an event immediately after a dialogue completes', async () => {
  const f = fixture();
  f.runtime.observeDialogue({ conversationId: 'c', canSubmit: true, turn: { phase: 'error', requestId: 'chat', message: 'Unavailable' } });
  f.social('after-chat'); await flush(); expect(f.generateEvent).toHaveBeenCalledTimes(1);
});

it('does not publish at the3500ms runtime deadline, even if the provider resolves successfully then', async () => {
  const f = fixture(); let resolve!: (value: { requestId: string; replyText: string }) => void;
  f.generateEvent.mockImplementationOnce(() => new Promise(yes => { resolve = yes; })); f.social('s'); await flush();
  await vi.advanceTimersByTimeAsync(3500); resolve({ requestId: 'r1', replyText: 'Поздно' }); await flush(); expect(f.runtime.getSpeech()).toBeNull(); expect(f.cancel).toHaveBeenCalledWith('r1');
});


it('allows events immediately at startup and beyond former minute/hour/session quotas', async () => {
  vi.setSystemTime(0);
  const f = fixture();
  for (let i = 0; i < 105; i++) {
    f.social(`social-${i}`); await flush(); f.socialEnd(`social-${i}`);
  }
  expect(f.generateEvent).toHaveBeenCalledTimes(105);
});
