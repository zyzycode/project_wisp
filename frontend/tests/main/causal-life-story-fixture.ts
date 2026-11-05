import { expect, vi } from 'vitest';
import { SqliteMemoryStore } from '../../src/infrastructure/memory/sqlite-store';
import { causalEpisode } from '../../src/infrastructure/memory/causal-life-validation';
import { deferredInvitation } from '../../src/infrastructure/memory/deferred-invitation-validation';
import { lifeWindow } from '../../src/infrastructure/memory/life-history-validation';
import type { Operation } from '../../src/infrastructure/memory/protocol';
import type { MemoryResult } from '../../src/application/ports/memory-repository.interface';
import type { ICausalLifeRepository, IDeferredGameInvitationRepository } from '../../src/application/ports/causal-life.interface';
import type { ILifeHistoryReader } from '../../src/application/ports/life-history.interface';
import { CausalLifeRecorder } from '../../src/application/services/causal-life-recorder';
import { OwnGameInterestRuntime } from '../../src/application/services/own-game-interest-runtime';
import { DeferredGameInvitationRuntime } from '../../src/application/services/deferred-game-invitation-runtime';
import { MemoryHistory } from '../../src/application/services/memory-history';
import { message } from '../../src/infrastructure/memory/validation';
import { LifeReflectionRuntime } from '../../src/application/services/life-reflection-runtime';
import type { CharacterStateService } from '../../src/application/services/character-state.service';
import type { CurrentComputerContext } from '../../src/application/ports/world-context.interface';
import { scenario } from './autonomy-scenario-fixture';
export const STORY_BASE = Date.parse('2026-11-01T10:00:00.000Z');
export const flushStory = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
export function causalStory(filename: string, invitations = false, persistent = true, computerContext?: () => CurrentComputerContext | undefined) {
  let store = SqliteMemoryStore.open(filename, new Date(STORY_BASE).toISOString());
  let generation = 0, currentCharacter: CharacterStateService | undefined;
  let own: OwnGameInterestRuntime | undefined, invite: DeferredGameInvitationRuntime | undefined;
  const context = () => persistent ? { generation } : null;
  const command = (operation: Operation, payload: unknown = null, requestGeneration = generation) => store.execute({ id: 1, operation, payload, generation: requestGeneration });
  const empty = (r: MemoryResult<unknown>): MemoryResult<void> => r.ok ? { ok: true, value: undefined } : r;
  const episodes = (r: MemoryResult<unknown>) => {
    if (!r.ok) return r;
    if (!Array.isArray(r.value)) throw new Error('Expected causal rows');
    return { ok: true as const, value: r.value.map(causalEpisode) };
  };
  const repository: ICausalLifeRepository = { append: async (e, c) => empty(command('appendCausalLife', e, c.generation)),
    getRecent: async (n, c) => episodes(command('recentCausalLife', n, c.generation)), resolveSources: async (refs, c) => episodes(command('resolveCausalLife', refs, c.generation)) };
  const invitationRepository: IDeferredGameInvitationRepository = {
    create: async (i, c) => empty(command('createDeferredInvitation', i, c.generation)),
    read: async (now, c) => { const r = command('readDeferredInvitation', now, c.generation); return r.ok ? { ok: true, value: r.value === null ? null : deferredInvitation(r.value) } : r; },
    claim: async (id, now, c) => { const r = command('claimDeferredInvitation', { id, now }, c.generation); if (!r.ok) return r;
      if (typeof r.value !== 'boolean') throw new Error('Expected claim receipt'); return { ok: true, value: r.value }; },
    finish: async (id, state, c) => empty(command('finishDeferredInvitation', { id, state }, c.generation)),
  };
  const reader: ILifeHistoryReader = { readWindow: async (query, c) => { const r = command('readLifeWindow', query, c.generation); return r.ok ? { ok: true, value: lifeWindow(r.value) } : r; } };
  let historyId = 0;
  const history = new MemoryHistory({ context, toTimestamp: at => new Date(STORY_BASE + at).toISOString(),
    createId: () => historyId++ === 0 ? 'story-app' : `story-history-${historyId}`, onFailure: vi.fn(),
    episodes: { append: async (e, c) => empty(command('appendEpisode', e, c.generation)) },
    history: {
      appendTurn: async (turn, c) => empty(command('appendTurn', turn, c.generation)),
      getRecent: async (n, c) => { const r = command('getRecent', n, c.generation); if (!r.ok) return r;
        if (!Array.isArray(r.value)) throw new Error('Expected history rows'); return { ok: true, value: r.value.map(message) }; },
      closeSession: async (sessionId, endedAt, c) => empty(command('closeSession', { sessionId, endedAt }, c.generation)),
      closeUnfinishedSessions: async (endedAt, c) => empty(command('closeUnfinishedSessions', endedAt, c.generation)),
    } });
  const recorder = new CausalLifeRecorder({ repository, appRunId: () => 'story-app', context, generation: () => generation,
    toTimestamp: at => new Date(STORY_BASE + at).toISOString(), onFailure: vi.fn(),
    onObserved: (e, at) => { currentCharacter?.observeCausalEpisode(e, at); invite?.observed(e, at); },
    commitObserver: { committed: (e, c, at) => { own?.committed(e, c, at); invite?.committed(e, c, at); } } });
  const social = vi.fn();
  const f = scenario({ energy: 70, play: 80, attention: 80, boredom: 80 }, .999, undefined, undefined, {
    systemIdle: { read: () => ({ status: 'available', idleMs: 1000 }), subscribeLifecycle: () => () => {}, dispose: () => {} },
    onActivityOutcome: e => recorder.outcome(e), onSocialBidStarted: social,
    onCursorGameResult: result => { void history.game(result, generation); },
    deferredInvitation: { opportunity: () => invite?.opportunity() ?? false, activityStarted: id => invite?.activityStarted(id),
      terminal: (id, done) => invite?.terminal(id, done), cancel: () => { void invite?.cancel(); }, invalidateAdmission: () => invite?.invalidateAdmission() },
  });
  currentCharacter = f.character;
  const scheduler = { setTimeout, clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  own = new OwnGameInterestRuntime({ character: f.character, repository, context, scheduler, now: f.now });
  if (invitations) invite = new DeferredGameInvitationRuntime({ repository: invitationRepository, context,
    ...(computerContext ? { computerContext } : {}),
    wallNow: () => STORY_BASE + f.now(), monotonicNow: f.now, creationAllowed: () => f.main.canRetainDeferredInvitation(),
    createId: () => 'story-invite', eligible: () => f.main.canStartDeferredInvitation(), start: () => f.main.startDeferredInvitation(),
    onOpportunityFinished: () => f.main.finishDeferredInvitationOpportunity() });
  const utc = () => new Date(STORY_BASE + f.now()).toISOString();
  const reflection = new LifeReflectionRuntime({ reader, barrier: recorder, context, timestamp: utc, scheduler });
  const sample = (x = 440) => f.main.handleCursorObservation({ x, y: 790 });
  const fresh = (ms: number, x = 440) => { for (let i = 0; i < ms; i += 100) { sample(x); f.advance(Math.min(100, ms - i)); } };
  const game = async (moving: boolean, interrupt = false) => {
    f.setRandom(.999); sample(900); sample();
    for (let i = 0; i < 5; i++) { f.advance(100); sample(); }
    f.setRandom(0); f.advance(100); if (f.main.getActivityTimeline()?.activityId !== 'cursor_interest') expect(sample()).toBe(true); else sample();
    fresh(200); fresh(200, moving ? 460 : 440);
    if (interrupt) { fresh(800); recorder.beginInput(false, f.now()); f.main.handleClick(); recorder.endInput(); }
    else fresh(2600);
    await recorder.whenSettled(); await flushStory();
    return f.outcomes.at(-1)!;
  };
  const reopen = () => { store.close(); store = SqliteMemoryStore.open(filename, utc()); };
  const reset = () => { generation++; recorder.reset(); history.reset(); own?.invalidate(); reflection.invalidate(); invite?.invalidate(); f.character.resetToDefaults();
    expect(command('clear').ok).toBe(true); };
  const dispose = async () => { reflection.dispose(); own?.dispose(); await invite?.dispose(); recorder.dispose(); f.main.dispose(); await history.close(utc()); store.close(); };
  return { ...f, recorder, repository, invitationRepository, own, invite, reflection, social, history, command, game, utc, reopen, reset, dispose, currentGeneration: () => generation };
}
