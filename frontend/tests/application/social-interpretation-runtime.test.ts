import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { SocialInterpretationRuntime } from '../../src/application/services/social-interpretation-runtime';
import type { ISocialInterpretationRepository, SocialInterpretation } from '../../src/application/ports/social-interpretation.interface';
import type { CausalLifeEpisode } from '../../src/application/ports/causal-life.interface';
import { scenario } from '../main/autonomy-scenario-fixture';

const base = Date.parse('2026-11-05T10:00:00.000Z');
const episode: CausalLifeEpisode = { appRunId: 'app', sequence: 2, revision: 1, occurredAt: new Date(base).toISOString(), source: 'user',
  activityRunId: 'game', activity: 'cursor_game', outcome: 'cancelled', terminalReason: 'user_interaction', cause: 'user_interrupted',
  triggerSequence: 1, executedMs: 2000, participation: 'user_engaged' };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function fixture() {
  let saved: SocialInterpretation | null = null, generation = 0, appRunId = 'app';
  const read = vi.fn<ISocialInterpretationRepository['read']>(async () => ({ ok: true as const, value: saved }));
  const replace = vi.fn<ISocialInterpretationRepository['replace']>(async (value, expected) => {
    if ((saved?.revision ?? null) !== expected) return { ok: false as const, code: 'conflict' as const };
    saved = value; return { ok: true as const, value: undefined };
  });
  const repository: ISocialInterpretationRepository = { read, replace, clear: vi.fn(async () => { saved = null; return { ok: true as const, value: undefined }; }) };
  const character = new CharacterStateService({ now: () => 0, monotonicNow: Date.now });
  character.observeCausalEpisode(episode, 0);
  const runtime = new SocialInterpretationRuntime({ repository, character, now: Date.now, timestamp: () => new Date(base + Date.now()).toISOString(),
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    context: () => ({ generation }), appRunId: () => appRunId });
  const report = (text = 'я случайно прервал игру', id = 'u1') => runtime.persisted({ text, userMessageId: id,
    conversationSessionId: 'session', createdAt: new Date(base + Date.now()).toISOString() }, { generation });
  return { runtime, character, read, replace, report, saved: () => saved, setSaved: (value: SocialInterpretation | null) => { saved = value; },
    changeGeneration: () => { generation++; runtime.invalidate(); }, changeAppRun: () => { appRunId = 'new'; } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => vi.useRealTimers());

it('commits an attributed explanation and reappraises only the current cause without rewarding facets or repeating reports', async () => {
  const f = fixture(), before = f.character.getState();
  f.runtime.committed(episode, { generation: 0 }, 0); await flush();
  expect(f.runtime.getCurrent()?.status).toBe('unknown'); expect(f.character.getCausalEmotion()?.intensity).toBe(.2);
  await f.report(); expect(f.runtime.getCurrent()?.status).toBe('reported_accidental'); expect(f.character.getCausalEmotion()?.intensity).toBe(.1);
  await f.report(); await f.report('я случайно прервала игру', 'same-report');
  expect(f.replace).toHaveBeenCalledTimes(2); expect(f.character.getCausalEmotion()?.intensity).toBe(.1);
  await f.report('i interrupted the game deliberately', 'u2');
  expect(f.runtime.getCurrent()).toMatchObject({ status: 'contradicted', reports: [{ userMessageId: 'u1' }, { userMessageId: 'u2' }] });
  expect(f.character.getCausalEmotion()?.intensity).toBe(.2); expect(f.character.getState()).toEqual(before);
  await f.report('я намеренно прервал игру', 'third'); expect(f.replace).toHaveBeenCalledTimes(3);
  f.runtime.dispose(); expect(vi.getTimerCount()).toBe(0);
});

it('reads/restarts without replay and removes only a current report factor after source correction', async () => {
  const f = fixture(); f.runtime.committed(episode, { generation: 0 }, 0); await flush(); await f.report();
  await f.runtime.refresh(); expect(f.character.getCausalEmotion()?.intensity).toBe(.1);
  f.setSaved({ ...f.saved()!, revision: 3, status: 'unknown', reports: [] });
  await f.runtime.refresh(); expect(f.character.getCausalEmotion()?.intensity).toBe(.2);
  await f.runtime.refresh(); expect(f.character.getCausalEmotion()?.intensity).toBe(.2);
  f.character.resetToDefaults(); await f.runtime.refresh(); expect(f.character.getCausalEmotion()).toBeNull();
  f.runtime.dispose();
});

it('closes binding at an actual new game start, including delayed interruption acknowledgements', async () => {
  const f = fixture(); f.runtime.gameStarted();
  f.runtime.committed(episode, { generation: 0 }, 0); await flush(); await f.report(); expect(f.read).not.toHaveBeenCalled();
  vi.setSystemTime(1000); const next = { ...episode, sequence: 4, triggerSequence: 3, occurredAt: new Date(base + 1000).toISOString() };
  f.character.observeCausalEpisode(next, 1000); f.runtime.committed(next, { generation: 0 }, 1000); await flush(); await f.report();
  const intensity = f.character.getCausalEmotion()!.intensity; f.runtime.gameStarted(); await f.report('i interrupted the game deliberately', 'u2');
  expect(f.runtime.getCurrent()?.status).toBe('reported_accidental'); expect(f.character.getCausalEmotion()!.intensity).toBe(intensity);
  f.runtime.dispose();
});

it.each(['reset', 'dispose', 'new-game', 'timeout'] as const)('does not apply a write acknowledged after %s', async change => {
  const f = fixture(); f.runtime.committed(episode, { generation: 0 }, 0); await flush();
  let resolve!: (value: Awaited<ReturnType<ISocialInterpretationRepository['replace']>>) => void;
  f.replace.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
  const pending = f.report(); await flush();
  if (change === 'reset') f.changeGeneration(); if (change === 'dispose') f.runtime.dispose(); if (change === 'new-game') f.runtime.gameStarted();
  if (change === 'timeout') await vi.advanceTimersByTimeAsync(200);
  resolve({ ok: true, value: undefined }); await pending; await flush();
  expect(f.character.getCausalEmotion()?.intensity).toBe(.2); expect(f.runtime.getCurrent()?.status).not.toBe('reported_accidental'); f.runtime.dispose();
});

it('coalesces a newer interruption while an old read waits and never binds an old appRun or expired window', async () => {
  const f = fixture(); let resolve!: (value: Awaited<ReturnType<ISocialInterpretationRepository['read']>>) => void;
  f.read.mockImplementationOnce(() => new Promise(yes => { resolve = yes; })); f.runtime.committed(episode, { generation: 0 }, 0);
  vi.setSystemTime(10); const latest = { ...episode, sequence: 4, triggerSequence: 3, occurredAt: new Date(base + 10).toISOString() };
  f.runtime.committed(latest, { generation: 0 }, 10); resolve({ ok: true, value: null }); await flush();
  expect(f.runtime.getCurrent()?.episode.sequence).toBe(4); expect(f.replace).toHaveBeenCalledOnce();
  vi.setSystemTime(300011); await f.report(); expect(f.replace).toHaveBeenCalledOnce();
  f.changeAppRun(); f.runtime.committed(latest, { generation: 0 }, 10); await f.report(); expect(f.replace).toHaveBeenCalledOnce(); f.runtime.dispose();
});
it('omits an unavailable store without changing the local emotion and rereads a CAS conflict without blind retry', async () => {
  const f = fixture(); f.read.mockResolvedValueOnce({ ok: false, code: 'unavailable' });
  f.runtime.committed(episode, { generation: 0 }, 0); await flush();
  expect(f.runtime.getCurrent()).toBeNull(); expect(f.character.getCausalEmotion()?.intensity).toBe(.2);
  await f.report(); expect(f.runtime.getCurrent()?.status).toBe('reported_accidental');
  f.replace.mockResolvedValueOnce({ ok: false, code: 'conflict' });
  const before = f.replace.mock.calls.length; await f.report('i interrupted the game deliberately', 'u2');
  expect(f.replace.mock.calls.length).toBe(before + 1); expect(f.runtime.getCurrent()?.status).toBe('reported_accidental');
  expect(f.character.getCausalEmotion()?.intensity).toBe(.1); f.runtime.dispose();
});
it('closes a clarification only when the real Main cursor activity actually starts', async () => {
  const f = fixture(); f.runtime.committed(episode, { generation: 0 }, 0); await flush();
  const main = scenario({}, .999, undefined, undefined, { onActivityCommitted: (_runId, activityId) => {
    if (activityId === 'cursor_interest') f.runtime.gameStarted();
  } });
  const sample = () => main.main.handleCursorObservation({ x: 440, y: 790 });
  sample(); for (let i = 0; i < 5; i++) { main.advance(100); vi.setSystemTime(main.now()); sample(); }
  main.setRandom(0); main.advance(100); vi.setSystemTime(main.now()); expect(sample()).toBe(true);
  expect(main.main.getActivityTimeline()?.activityId).toBe('cursor_interest');
  await f.report(); expect(f.replace).toHaveBeenCalledOnce(); expect(f.runtime.getCurrent()?.status).toBe('unknown');
  main.main.dispose(); f.runtime.dispose();
});
it('closes an old clarification at accepted cursor commit even when its first visual callback cancels the run', async () => {
  const f = fixture(); f.runtime.committed(episode, { generation: 0 }, 0); await flush();
  let owner: ReturnType<typeof scenario>['main'] | undefined;
  const started = vi.fn(), outcome = vi.fn();
  const main = scenario({}, .999, undefined, undefined, {
    onActivityCommitted: (_runId, activityId) => { if (activityId === 'cursor_interest') f.runtime.gameStarted(); },
    onActivityStarted: (_runId, activityId) => { started(activityId); },
    onActivityOutcome: outcome,
    onPresentationChanged: () => { if (owner?.getActivityTimeline()?.activityId === 'cursor_interest') owner.resetCursorGame(); },
  }); owner = main.main;
  const sample = () => main.main.handleCursorObservation({ x: 440, y: 790 });
  sample(); for (let i = 0; i < 5; i++) { main.advance(100); vi.setSystemTime(main.now()); sample(); }
  main.setRandom(0); main.advance(100); vi.setSystemTime(main.now()); sample();
  expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ activity: 'cursor_game', outcome: 'cancelled' }));
  expect(started).not.toHaveBeenCalled(); expect(main.main.getActivityTimeline()).toBeNull();
  await f.report(); expect(f.replace).toHaveBeenCalledOnce(); expect(f.runtime.getCurrent()?.status).toBe('unknown');
  main.main.dispose(); f.runtime.dispose();
});
it('never restores expired affect or touches a different Character generation during report invalidation', async () => {
  const f = fixture(); f.runtime.committed(episode, { generation: 0 }, 0); await flush(); await f.report();
  vi.setSystemTime(90000); f.character.tickNeeds(90000); expect(f.character.getCausalEmotion()).toBeNull();
  f.runtime.invalidate(); expect(f.character.getCausalEmotion()).toBeNull();
  f.runtime.dispose();
  const next = fixture(); next.runtime.committed(episode, { generation: 0 }, 0); await flush(); await next.report();
  next.character.resetToDefaults(); next.character.observeCausalEpisode(episode, Date.now());
  next.character.reappraiseInterruption(2, 'reported_accidental', Date.now());
  const current = next.character.getCausalEmotion(); next.runtime.invalidate(); expect(next.character.getCausalEmotion()).toEqual(current); next.runtime.dispose();
});
