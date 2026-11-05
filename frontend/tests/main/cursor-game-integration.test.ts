import { describe, expect, it } from 'vitest';
import { scenario } from './autonomy-scenario-fixture';

function game() {
  const f = scenario(); f.setRandom(.999);
  const sample = (x = 440) => f.main.handleCursorObservation({ x, y: 790 });
  sample(); for (let i = 0; i < 5; i++) { f.advance(100); sample(); }
  f.setRandom(0); f.advance(100); expect(sample()).toBe(true);
  expect(f.main.getActivityTimeline()?.activityId).toBe('cursor_interest');
  const fresh = (ms: number, x = 440) => { for (let i = 0; i < ms; i += 100) { sample(x); f.advance(Math.min(100, ms - i)); } };
  return { ...f, sample, fresh };
}
describe('autonomous cursor game', () => {
  it('chases in fixed legs, then attempts and catches within the same run', () => {
    const f = game(); const runId = f.main.getActivityTimeline()?.runId;
    f.fresh(600, 520); expect(f.main.getActivityTimeline()?.phaseId).toBe('approach_1');
    f.fresh(500, 600); expect(f.move).toHaveBeenCalledTimes(1);
    f.arrive(); expect(f.main.getActivityTimeline()?.phaseId).toBe('approach_2');
    expect(f.move).toHaveBeenCalledTimes(2);
    expect(f.move.mock.calls[1]?.[0].targetRootPosition.x).toBe(560);
    f.fresh(500, 560); f.arrive(); expect(f.main.getActivityTimeline()?.phaseId).toBe('attempt');
    f.fresh(1000, 560); expect(f.main.getCursorGamePresentation()?.outcome).toBe('caught');
    expect(f.main.getActivityTimeline()?.runId).toBe(runId);
    f.fresh(1200, 560); expect(f.outcomes).toHaveLength(1); f.main.dispose();
  });
  it('records real post-start cursor movement as engaged input on the completed system-initiated game', () => {
    const f = game();
    f.fresh(200, 440); f.fresh(200, 460); f.fresh(2400, 440);
    expect(f.outcomes).toHaveLength(1);
    expect(f.outcomes[0]).toMatchObject({ activity: 'cursor_game', outcome: 'completed', playCompleted: true, participation: 'user_engaged' });
    f.main.dispose();
  });
  it('ignores movement first observed after the game outcome has already been decided', () => {
    const f = game(); f.fresh(1600); expect(f.main.getCursorGamePresentation()?.outcome).toBe('caught');
    f.fresh(200, 460); f.fresh(1000, 440);
    expect(f.outcomes[0]).toMatchObject({ outcome: 'completed', participation: 'solitary' }); f.main.dispose();
  });
  it('drops the participation latch when the terminal clock goes backwards', () => {
    const f = game(); f.fresh(200); f.fresh(200, 460); f.elapse(-101); f.main.handleClick();
    expect(f.outcomes[0]).toMatchObject({ outcome: 'cancelled', participation: 'solitary' }); f.main.dispose();
  });
  it('does not carry observed participation into the next independently admitted stationary run', () => {
    const f = game(); f.fresh(200); f.fresh(200, 460); f.fresh(2600);
    expect(f.outcomes[0]?.participation).toBe('user_engaged');
    f.elapse(31000); f.setRandom(0); f.sample(900); f.sample();
    for (let i = 0; i < 6 && f.main.getActivityTimeline()?.activityId !== 'cursor_interest'; i++) { f.advance(100); f.sample(); }
    expect(f.main.getActivityTimeline()?.activityId).toBe('cursor_interest'); f.fresh(3000);
    expect(f.outcomes).toHaveLength(2); expect(f.outcomes[1]?.participation).toBe('solitary'); f.main.dispose();
  });
  it('plays, speaks, rewards once and refuses an ignored stationary replay', () => {
    const f = game(); const relationship = f.character.getState().relationship;
    f.fresh(600); expect(f.main.getActivityTimeline()?.phaseId).toBe('attempt');
    expect(f.main.getCursorGamePresentation()?.speech?.text).toBe('Стой, я почти поймала!');
    f.fresh(1000); expect(f.main.getCursorGamePresentation()).toMatchObject({ outcome: 'caught', speech: { text: 'Поймала!' } });
    f.fresh(1200); expect(f.main.getActivityTimeline()).toBeNull();
    expect(f.outcomes).toHaveLength(1); expect(f.outcomes[0]).toMatchObject({ playCompleted: true, participation: 'solitary' });
    expect(f.character.getState().relationship).toEqual(relationship);
    f.main.notifyVoluntaryMovementCompleted(); expect(f.outcomes).toHaveLength(1);
    f.setRandom(.999); f.fresh(31000); f.setRandom(0); f.sample();
    expect(f.main.getActivityTimeline()?.activityId).not.toBe('cursor_interest'); f.main.dispose();
  });
  it('misses a fast cursor without turning its speech into an AI request', () => {
    const f = game(); f.fresh(600); f.fresh(1000, 500);
    expect(f.main.getCursorGamePresentation()).toMatchObject({ outcome: 'missed', speech: { text: 'В этот раз ты быстрее.' } });
    f.fresh(1200, 500); expect(f.outcomes[0]?.playCompleted).toBe(true); f.main.dispose();
  });
  it('loses stale input and has a bounded safe reaction', () => {
    const f = game(); f.advance(301);
    expect(f.main.getCursorGamePresentation()?.outcome).toBe('lost_target');
    expect(f.main.getVisualEpisode().intent.kind).toBe('confused_reaction');
    f.advance(600); f.advance(600); expect(f.main.getActivityTimeline()).toBeNull();
    expect(f.outcomes[0]?.playCompleted).toBe(false); f.main.dispose();
  });
  it.each(['quiet', 'menu', 'disable', 'click', 'reset', 'dispose', 'dialogue', 'support'] as const)('cancels immediately on %s, without resume', mode => {
    const f = game(); f.fresh(600);
    const stop = { quiet: () => f.main.setQuietMode(true), menu: () => f.main.setMenuOpen(true),
      disable: () => f.main.setEnabled(false), click: () => f.main.handleClick(), reset: () => f.main.resetCursorGame(),
      dispose: () => f.main.dispose(), dialogue: () => f.main.beginDialogueThinking('request'), support: () => f.main.handleSupportLost() };
    stop[mode](); expect(f.main.getActivityTimeline()).toBeNull(); expect(f.main.getCursorGamePresentation()).toBeNull();
    expect(f.outcomes).toHaveLength(1); expect(f.outcomes[0]?.playCompleted).toBe(false);
    f.main.setQuietMode(false); f.main.setMenuOpen(false); f.main.setEnabled(true);
    expect(f.main.getActivityTimeline()).toBeNull(); f.main.dispose(); expect(f.outcomes).toHaveLength(1);
  });
  it('preserves completed attempt feedback on interruption during reaction', () => {
    const f = game(); f.fresh(1600); f.main.handleClick();
    expect(f.outcomes).toHaveLength(1); expect(f.outcomes[0]).toMatchObject({ outcome: 'cancelled', playCompleted: true });
    expect(f.main.getCursorGamePresentation()).toBeNull(); f.main.dispose();
  });
});
