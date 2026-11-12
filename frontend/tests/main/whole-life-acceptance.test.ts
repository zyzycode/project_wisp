import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { causalStory, flushStory } from './causal-life-story-fixture';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { projectCharacterMemory, restoreCharacterMemory } from '../../src/application/services/character-memory-snapshot';
import { OwnGameInterestRuntime } from '../../src/application/services/own-game-interest-runtime';
import { createCharacterAutonomySnapshot } from '../../src/domain/character/autonomy-character-engine';
import { selectLocalActivity } from '../../src/domain/behavior/local-activity-policy';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function liveHistory(interrupted: boolean) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wisp-whole-life-'));
  directories.push(directory);
  const f = causalStory(path.join(directory, 'memory.sqlite3'));
  try {
    const initial = f.character.getState();
    for (let index = 0; index < 6; index++) {
      f.elapse(index > 0 && index % 2 === 0 ? 86_400_000 : 300_000);
      const outcome = await f.game(true, interrupted);
      expect(outcome).toMatchObject({ activity: 'cursor_game', participation: 'user_engaged',
        outcome: interrupted ? 'cancelled' : 'completed' });
      expect(f.character.getCursorGameSatiation()).toBeGreaterThanOrEqual(0);
      expect(f.character.getCursorGameSatiation()).toBeLessThanOrEqual(1);
    }
    await f.own.revalidate();
    const state = f.character.getState();
    expect(state.preferences['own.activity.cursor_game']?.samples).toBe(interrupted ? undefined : 6);
    const emotion = f.character.getCausalEmotion();
    const interest = f.character.getOwnGameInterest();
    const reflection = await f.reflection.capture('our game');
    expect(f.outcomes).toHaveLength(6);
    expect(state.personality).toEqual(initial.personality);
    expect(state.relationship.affection).toBeGreaterThanOrEqual(initial.relationship.affection);
    expect(interest.band).toBe(interrupted ? 'none' : 'emerging');
    expect(reflection?.observation.completedCount).toBe(interrupted ? undefined : 6);
    expect(emotion?.kind).toBe(interrupted ? 'irritated' : 'content');

    // Compare the same eligible choice context, so a needs difference cannot explain away affect.
    const selection = selectLocalActivity({ ...createCharacterAutonomySnapshot(state, 0, emotion),
      needs: { energy: 70, comfort: 20, boredom: 40, attention: 100, play: 0 } },
    { nowMs: f.now(), canExplore: false, canPlay: false, canRest: false, canSocial: true, history: [] }, .999);
    const social = selection.trace.find(row => row.kind === 'social_bid');
    expect(social?.eligible).toBe(true);
    expect(social?.emotionMultiplier).toBe(interrupted ? .96 : 1);

    const checkpoint = projectCharacterMemory(state, f.utc());
    const sources = f.command('recentCausalLife', 100);
    expect(f.command('saveSnapshot', checkpoint).ok).toBe(true);
    f.reopen();
    expect(f.command('loadSnapshot')).toEqual({ ok: true, value: checkpoint });
    expect(f.command('recentCausalLife', 100)).toEqual(sources);
    const restarted = new CharacterStateService({ now: f.now, monotonicNow: f.now });
    restarted.replaceRestoredState(restoreCharacterMemory(checkpoint, restarted.createDefaults(), f.now()));
    expect(restarted.getState().relationship).toEqual(state.relationship);
    expect(restarted.getState().preferences).toEqual(state.preferences);
    expect(restarted.getCausalEmotion()).toBeNull();
    const proof = new OwnGameInterestRuntime({ character: restarted, repository: f.repository,
      context: () => ({ generation: f.currentGeneration() }), now: f.now,
      scheduler: { setTimeout, clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>) } });
    try {
      await proof.revalidate();
      expect(restarted.getOwnGameInterest()).toEqual(interest);
      const restored = restarted.getState();
      await proof.revalidate();
      expect(restarted.getState()).toEqual(restored);
    } finally { proof.dispose(); }

    // The same profile can actually finish a different local activity, with no provider.
    f.main.suspendForUserInteraction();
    f.character.replaceRestoredState({ ...state, needs: { energy: 70, boredom: 100, comfort: 20, play: 0, attention: 0 } });
    f.setRandom(.75); f.main.resumeAfterUserInteraction(); f.pulse();
    expect(f.main.getActivityTimeline()?.activityId).toBe('book');
    f.finish(); await f.recorder.whenSettled(); await flushStory();
    expect(f.outcomes.at(-1)).toMatchObject({ activity: 'book', outcome: 'completed', executedMs: 14_000 });
    expect(f.character.getBookSatiation()).toBeCloseTo(14_000 / 60_000);
    expect(f.character.getCausalEmotion()).toMatchObject({ activity: 'book', kind: 'content', target: 'self' });
    expect(f.command('recentCausalLife', 100)).toMatchObject({ ok: true,
      value: expect.arrayContaining([expect.objectContaining({ activity: 'book', cause: 'completed', participation: 'solitary' })]) });

    const oldGeneration = f.currentGeneration();
    const persisted = await f.repository.getRecent(100, { generation: oldGeneration });
    expect(persisted.ok).toBe(true);
    f.reset();
    expect(await f.reflection.capture('our game')).toBeUndefined();
    expect(f.character.getOwnGameInterest().band).toBe('none');
    if (persisted.ok) {
      expect(await f.repository.append(persisted.value[0]!, { generation: oldGeneration })).toEqual({ ok: false, code: 'stale' });
    }
    expect(f.command('resolveCausalLife', interest.sources)).toEqual({ ok: true, value: [] });
    expect(f.command('recentCausalLife', 100)).toEqual({ ok: true, value: [] });
    return { relationship: state.relationship, preferences: state.preferences, personality: state.personality,
      interest, reflection: reflection?.observation, outcomes: f.outcomes, selection: selection.trace };
  } finally { await f.dispose(); }
}

it('replays two isolated real histories deterministically and preserves their distinct evidence through restart and reset', async () => {
  const together = await liveHistory(false);
  const interrupted = await liveHistory(true);
  expect(await liveHistory(false)).toEqual(together);
  expect(await liveHistory(true)).toEqual(interrupted);
  expect(together.personality).toEqual(interrupted.personality);
  expect(together.relationship.trust).toBeGreaterThan(interrupted.relationship.trust);
  expect(together.interest.multiplier).toBeGreaterThan(interrupted.interest.multiplier);
  expect(together.outcomes.filter(event => event.outcome === 'completed')).toHaveLength(7);
  expect(interrupted.outcomes.filter(event => event.outcome === 'cancelled')).toHaveLength(6);
  expect(interrupted.outcomes.filter(event => event.activity === 'book' && event.outcome === 'completed')).toHaveLength(1);
});
