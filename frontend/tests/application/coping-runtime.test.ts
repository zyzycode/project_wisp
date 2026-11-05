import { expect, it } from 'vitest';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { CopingRuntime } from '../../src/application/services/coping-runtime';
import type { CausalLifeEpisode } from '../../src/application/ports/causal-life.interface';
import type { SocialInterpretation } from '../../src/application/ports/social-interpretation.interface';
const episode: CausalLifeEpisode = { appRunId: 'app', sequence: 2, revision: 1, occurredAt: '2026-11-05T10:00:00.000Z', source: 'user', triggerSequence: 1,
  activityRunId: 'game', activity: 'cursor_game', outcome: 'cancelled', terminalReason: 'user_interaction', cause: 'user_interrupted', executedMs: 1200, participation: 'user_engaged' };
function fixture() {
  let now = 30000;
  const character = new CharacterStateService({ now: () => now, monotonicNow: () => now });
  const coping = new CopingRuntime({ character, now: () => now, appRunId: () => 'app', interpretation: () => null });
  const observe = () => { character.observeCausalEpisode(episode, now); coping.observed(episode, now); };
  return { character, coping, observe, setNow: (value: number) => { now = value; } };
}
it('completed offline coping changes only current affect and preserves relief when report factor is withdrawn', () => {
  const f = fixture(); f.observe(); const before = f.character.getState();
  f.character.reappraiseInterruption(2, 'reported_accidental', 30000);
  expect(f.coping.consider({ free: true, menu: false, blocked: false })).toBe('pause');
  f.coping.selected('idle', true); f.coping.activityCommitted('calm', 'calm'); f.coping.terminal('calm', true);
  expect(f.character.getCausalEmotion()?.intensity).toBeCloseTo(.05);
  f.character.reappraiseInterruption(2, 'unknown', 30000);
  expect(f.character.getCausalEmotion()?.intensity).toBeCloseTo(.1);
  expect(f.character.getState()).toEqual(before);
  f.coping.terminal('calm', true); expect(f.character.getCausalEmotion()?.intensity).toBeCloseTo(.1);
});
it('cancel/reset/dispose never relieve a replaced or expired affect', () => {
  for (const action of ['cancel', 'reset', 'dispose', 'expire'] as const) {
    const f = fixture(); f.observe(); f.coping.consider({ free: true, menu: false, blocked: false });
    f.coping.selected('idle', true); f.coping.activityCommitted('calm', 'calm');
    if (action === 'cancel') f.coping.cancel();
    if (action === 'reset') f.character.resetToDefaults();
    if (action === 'dispose') f.coping.dispose();
    if (action === 'expire') { for (let i = 1; i <= 4; i++) { f.setNow(30000 + i * 60000); f.character.tickNeeds(60000); } }
    const emotion = f.character.getCausalEmotion(); f.coping.terminal('calm', true);
    expect(f.character.getCausalEmotion()).toEqual(emotion);
  }
});
it('a committed accidental report can choose Explore without extending the initial opportunity', () => {
  let now = 30000, report: SocialInterpretation | null = null;
  const character = new CharacterStateService({ now: () => now, monotonicNow: () => now });
  const coping = new CopingRuntime({ character, now: () => now, appRunId: () => 'app', interpretation: () => report });
  character.observeCausalEpisode(episode, now); coping.observed(episode, now);
  report = { revision: 2, episode: { appRunId: 'app', sequence: 2, revision: 1 }, status: 'reported_accidental', reports: [],
    createdAt: episode.occurredAt, expiresAt: '2026-11-06T10:00:00.000Z' };
  character.reappraiseInterruption(2, 'reported_accidental', now);
  now = 59999;
  expect(coping.consider({ free: true, menu: false, blocked: false })).toBe('explore');
  coping.selected('wander', true); coping.activityCommitted('explore', 'explore');
  now = 61000; character.tickNeeds(1001); const before = character.getState();
  coping.terminal('explore', true);
  expect(character.getState()).toEqual(before);
  expect(coping.consider({ free: true, menu: false, blocked: false })).toBeNull();
});
