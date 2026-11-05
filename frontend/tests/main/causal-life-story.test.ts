import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { causalStory, flushStory } from './causal-life-story-fixture';
import { projectCharacterMemory, restoreCharacterMemory } from '../../src/application/services/character-memory-snapshot';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { OwnGameInterestRuntime } from '../../src/application/services/own-game-interest-runtime';
const dirs: string[] = [];
const filename = () => { const dir = mkdtempSync(path.join(os.tmpdir(), 'wisp-causal-story-')); dirs.push(dir); return path.join(dir, 'memory.sqlite3'); };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it('connects actual game input, local appraisal, durable source and a later real P4 invitation without replay', async () => {
  const f = causalStory(filename(), true);
  try {
    f.elapse(300000);
    const before = f.character.getState();
    const event = await f.game(true);
    expect(event).toMatchObject({ activity: 'cursor_game', participation: 'user_engaged', outcome: 'completed', playCompleted: true });
    expect(f.character.getCausalEmotion()).toMatchObject({ cause: 'completed', kind: 'content', target: 'user' });
    expect(f.character.getState().relationship.trust).toBe(before.relationship.trust + 1);
    expect(f.character.getState().preferences['own.activity.cursor_game']?.samples).toBe(1);
    expect(f.command('recentCausalLife', 100)).toMatchObject({ ok: true, value: [{ activityRunId: event.activityRunId, participation: 'user_engaged' }] });
    f.recorder.outcome(event); await flushStory();
    expect(f.character.getState().preferences['own.activity.cursor_game']?.samples).toBe(1);
    expect(f.invite?.hasPendingInvitation()).toBe(true);
    f.elapse(300000); f.main.tick(); f.advance(1000); expect(f.main.canStartDeferredInvitation()).toBe(true); f.pulse(); await flushStory();
    expect(f.main.getActivityTimeline()?.activityId).toBe('social_bid'); expect(f.social).toHaveBeenCalledOnce();
    f.finish(); await flushStory();
    expect(f.command('readDeferredInvitation', f.utc())).toMatchObject({ ok: true, value: { state: 'completed' } });
    f.reopen(); expect(f.command('readDeferredInvitation', f.utc())).toMatchObject({ ok: true, value: { state: 'completed' } });
    expect(await f.invitationRepository.claim('story-invite', f.utc(), { generation: 0 })).toEqual({ ok: true, value: false });
  } finally { await f.dispose(); }
});
it('two real six-run histories produce different own interest/reflection and survive a SQLite checkpoint restart without learning on read', async () => {
  for (const moving of [false, true]) {
    const f = causalStory(filename());
    try {
      for (let i = 0; i < 6; i++) {
        f.elapse(i % 2 === 0 && i > 0 ? 86400000 : 300000);
        const event = await f.game(moving);
        expect(event.participation).toBe(moving ? 'user_engaged' : 'solitary');
      }
      expect(f.outcomes).toHaveLength(6);
      expect(f.character.getOwnGameInterest().band).toBe(moving ? 'emerging' : 'none');
      expect((await f.reflection.capture('our game'))?.observation.completedCount).toBe(moving ? 6 : undefined);
      const before = f.character.getState(), checkpoint = projectCharacterMemory(before, f.utc());
      expect(f.command('saveSnapshot', checkpoint).ok).toBe(true); f.reopen();
      expect(f.command('loadSnapshot')).toEqual({ ok: true, value: checkpoint });
      const restarted = new CharacterStateService({ now: f.now, monotonicNow: f.now });
      restarted.replaceRestoredState(restoreCharacterMemory(checkpoint, restarted.createDefaults(), f.now()));
      expect(restarted.getState().relationship).toEqual(before.relationship);
      expect(restarted.getState().preferences).toEqual(before.preferences);
      expect(restarted.getOwnGameInterest().band).toBe('none');
      const restoredOwn = new OwnGameInterestRuntime({ character: restarted, repository: f.repository, context: () => ({ generation: 0 }),
        scheduler: { setTimeout, clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) }, now: f.now });
      try {
        await restoredOwn.revalidate(); expect(restarted.getOwnGameInterest().band).toBe(moving ? 'emerging' : 'none');
        const proven = restarted.getState(); await restoredOwn.revalidate(); expect(restarted.getState()).toEqual(proven);
      } finally { restoredOwn.dispose(); }
      await f.own.revalidate(); await f.reflection.capture('our game');
      expect(f.character.getState()).toEqual(before);
      f.reset(); expect(await f.reflection.capture('our game')).toBeUndefined();
      expect(f.command('recentCausalLife', 100)).toEqual({ ok: true, value: [] });
    } finally { await f.dispose(); }
  }
});
