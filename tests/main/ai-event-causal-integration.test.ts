import { expect, it, vi } from 'vitest';
import { scenario } from './autonomy-scenario-fixture';
import { AIEventRuntime } from '../../src/application/services/ai-event-runtime';
import { AIRequestControl } from '../../src/application/services/ai-request-control';
import { MemoryHistory } from '../../src/application/services/memory-history';
import { emptyMemoryContext } from '../../src/application/services/memory-recall';
import type { IAIEventProvider } from '../../src/application/ports/ai-event-provider.interface';
import type { MemoryResult } from '../../src/application/ports/memory-repository.interface';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture(social = false) {
  let events: AIEventRuntime | undefined, history: MemoryHistory | undefined, id = 0;
  const f = scenario(social ? { attention: 85, play: 30, boredom: 20 } : {}, social ? .99 : 0, undefined, undefined, {
    onActivityStarted: () => events?.activityStarted(), onSocialBidStarted: (runId, atMs) => events?.socialStarted(runId, atMs),
    onCursorGameResult: result => { events?.gameTerminal(result, 0); void history?.game(result, 0); }, onActivityOutcome: event => events?.outcome(event),
    onAIInvalidated: () => events?.invalidate(), onUserContact: () => events?.userContact(),
  });
  const timers = new Map<number, { at: number; callback: () => void }>();
  const generateEvent = vi.fn<IAIEventProvider['generateEvent']>(async request => ({ requestId: request.requestId, replyText: 'Вспомним нашу игру?' }));
  events = new AIEventRuntime({ provider: { generateEvent, cancel: vi.fn() }, control: new AIRequestControl(undefined, -300000),
    recall: { recall: async () => ({ ok: true, value: emptyMemoryContext() }) }, now: f.now, timestamp: () => new Date(f.now()).toISOString(), createId: () => `request-${++id}`,
    scheduler: { setTimeout: (callback, delay) => { const key = ++id; timers.set(key, { at: f.now() + delay, callback }); return key; }, clearTimeout: key => { timers.delete(key as number); } },
    character: () => f.character.getSnapshot(), gate: () => ({ ...f.main.getAIEventState(), memoryGeneration: 0, identity: 'stream:c:0' }), publish: vi.fn() });
  const append = vi.fn(async (): Promise<MemoryResult<void>> => ({ ok: true, value: undefined }));
  history = new MemoryHistory({ history: { appendTurn: vi.fn(), getRecent: vi.fn(), closeSession: vi.fn(), closeUnfinishedSessions: vi.fn() }, episodes: { append }, context: () => ({ generation: 0 }), createId: () => `memory-${++id}`, toTimestamp: time => new Date(time).toISOString(), onFailure: vi.fn(), gameObserver: events });
  const step = async (ms: number) => { f.advance(ms); events?.tick(); for (const [key, timer] of timers) if (timer.at <= f.now()) { timers.delete(key); timer.callback(); } await flush(); };
  return { ...f, events, append, generateEvent, step };
}
it('wires a real game terminal through acknowledged memory to optional speech without a second Character reward', async () => {
  const f = fixture(); let ack!: (value: MemoryResult<void>) => void;
  f.append.mockImplementationOnce(() => new Promise(resolve => { ack = resolve; }));
  const sample = () => f.main.handleCursorObservation({ x: 440, y: 790 }); sample();
  for (let i = 0; i < 5; i++) { f.advance(100); sample(); }
  expect(f.main.getActivityTimeline()?.activityId).toBe('cursor_interest');
  for (let i = 0; i < 28; i++) { sample(); f.advance(100); }
  expect(f.outcomes).toMatchObject([{ family: 'cursor_interest', outcome: 'completed', playCompleted: true }]);
  expect(f.append).toHaveBeenCalledTimes(1); expect(f.generateEvent).not.toHaveBeenCalled();
  const relationship = f.character.getState().relationship;
  ack({ ok: true, value: undefined }); await flush(); await f.step(2000);
  expect(f.generateEvent).toHaveBeenCalledTimes(1); expect(f.events.getSpeech()?.text).toBe('Вспомним нашу игру?');
  expect(f.character.getState().relationship).toEqual(relationship); expect(f.append).toHaveBeenCalledTimes(1);
  f.main.dispose(); f.events.dispose();
});
it('wires actual SocialBid start after local admission; quiet cancels the speech without changing relationship', async () => {
  const f = fixture(true), relationship = f.character.getState().relationship;
  f.pulse(); expect(f.main.getActivityTimeline()?.activityId).toBe('social_bid'); await flush();
  expect(f.generateEvent).toHaveBeenCalledTimes(1); expect(f.events.getSpeech()).not.toBeNull();
  expect(f.append).not.toHaveBeenCalled(); f.main.setQuietMode(true); expect(f.events.getSpeech()).toBeNull();
  expect(f.character.getState().relationship).toEqual(relationship); f.main.dispose(); f.events.dispose();
});
