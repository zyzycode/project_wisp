import { metabolizeNeeds } from '../../src/domain/character/metabolism';
import { describe, expect, it } from 'vitest';
import { scenario } from './autonomy-scenario-fixture';
describe('real Character closed loop', () => {
  it.each([
    ['soft_landing', 800], ['stumble', 800], ['crash_landing', 1600],
  ] as const)('selects an activity after %s recovery without another idle delay', (outcome, recoveryMs) => {
    const f = scenario({}, 0);
    f.main.beginDrag();
    f.main.handleMotionEvent({ type: 'landed', outcome, impactSeverity: 0 });
    expect(f.timers.size).toBe(1);
    expect([...f.timers.values()][0]?.atMs).toBe(f.now() + recoveryMs);
    expect(f.main.getActivityTimeline()).toBeNull();
    f.pulse();
    expect(f.main.getActivityTimeline()).not.toBeNull();
    f.finish();
    expect([...f.timers.values()][0]!.atMs - f.now()).toBeGreaterThanOrEqual(5000);
    f.main.dispose();
  });

  it('cancels the pending landing continuation when picked up again', () => {
    const f = scenario();
    f.main.beginDrag();
    f.main.handleMotionEvent({ type: 'landed', outcome: 'soft_landing', impactSeverity: 0 });
    const stale = [...f.timers.values()][0]!.callback;
    f.main.beginDrag();
    stale();
    expect(f.timers.size).toBe(0);
    expect(f.main.getActivityTimeline()).toBeNull();
    f.main.dispose();
  });

  it('admits user play before reward, saturates once and blocks the next game', () => {
    const f = scenario(); const before = f.character.getState();
    expect(f.play()).toBe(true); expect(f.character.getState()).toEqual(before);
    expect(f.move.mock.calls[0]?.[0].speedPxPerSec).toBe(180);
    f.arrive(); f.main.handleClick(); // completed sprint earns its effect even if settle is cancelled
    expect(f.character.getState().needs.play).toBe(before.needs.play - 15);
    expect(f.character.getState().needs.boredom).toBe(before.needs.boredom! - 18);
    expect(f.character.getState().relationship.friendship).toBe(before.relationship.friendship + 3);
    const after = f.character.getState(); f.main.notifyVoluntaryMovementCompleted({ runId: 'foreign', stepId: 'sprint' });
    expect(f.play()).toBe(false); expect(f.character.getState()).toEqual(after);
    expect(f.outcomes.filter(e => e.playCompleted)).toHaveLength(1);
    f.main.dispose();
  });
  it('cancel before game execution and critical rejection have no game reward', () => {
    const f = scenario(); expect(f.play()).toBe(true); f.main.beginDrag();
    expect(f.character.getState().needs.play).toBe(80);
    expect(f.outcomes[0]?.playCompleted).toBe(false); f.main.dispose();
    const exhausted = scenario({ energy: 20 }); expect(exhausted.play()).toBe(false);
    expect(exhausted.character.getState().needs.play).toBe(80); exhausted.main.dispose();
  });
  it('finishes an Explore chain before rewarding solitary exploration', () => {
    const f = scenario({ play: 30 }, .5); const before = f.character.getState(); f.pulse();
    expect(f.main.getActivityTimeline()?.activityId).toBe('explore');
    f.arrive(); expect(f.outcomes).toHaveLength(0); f.finish();
    expect(f.outcomes.filter(e => e.family === 'explore' && e.outcome === 'completed')).toHaveLength(1);
    expect(f.character.getState().needs.boredom).toBeLessThan(before.needs.boredom! - 7);
    expect(f.character.getState().relationship).toEqual(before.relationship);
    expect(f.timers.size).toBe(1); f.main.dispose();
  });
  it('wakes stable sleep on attention and retains quiet with one scheduler', () => {
    const f = scenario({ energy: 30, attention: 91 }); f.main.setQuietMode(true);
    expect(f.main.requestSleepWake({ action: 'sleep' })).toBe(true); f.advance(0);
    expect(f.main.isSleepingForRecovery()).toBe(false); expect(f.main.getAutonomyMode().quiet).toBe(true);
    expect(f.timers.size).toBe(1); f.main.dispose();
  });
  it('keeps awake fatigue from using the sleep recovery profile', () => {
    const f = scenario({ energy: 19 }); const before = f.character.getState().needs;
    f.character.tickNeeds(60000); expect(f.character.getState().needs).toEqual(metabolizeNeeds(before, 60000, 'neutral'));
    f.main.dispose();
  });
  it('shares quiet/budget social admission and gives no penalty for an ignored bid', () => {
    const f = scenario({ attention: 85, play: 30, boredom: 20 }, .99);
    const before = f.character.getState().relationship; f.pulse();
    expect(f.main.getActivityTimeline()?.activityId).toBe('social_bid'); f.finish();
    expect(f.character.getState().relationship).toEqual(before);
    f.main.setQuietMode(true); f.pulse(); expect(f.main.getActivityTimeline()?.activityId).not.toBe('social_bid');
    f.main.setQuietMode(false); expect(f.timers.size).toBeLessThanOrEqual(1); f.main.dispose();
  });
  it('preempts a local run with AI, protects ownership and resumes once', () => {
    const f = scenario({ play: 30 }, .5); f.pulse(); const local = f.main.getActivityTimeline()?.runId;
    expect(f.offer('respond').status).toBe('admitted');
    const ai = f.main.getActivityTimeline(); expect(ai?.runId).not.toBe(local); expect(ai?.activityId).toBe('expression');
    expect(f.main.handleCursorObservation({ x: 420, y: 790 })).toBe(false);
    f.main.beginDialogueThinking('other'); expect(f.main.getActivityTimeline()).toEqual(ai);
    f.advance(3000); expect(f.main.getActivityTimeline()).toBeNull(); expect(f.timers.size).toBe(1);
    f.pulse(); expect(f.main.getActivityTimeline()).not.toBeNull(); f.main.dispose();
  });
  it('keeps direct user ownership and rejects quiet/forced AI requests', () => {
    const f = scenario(); expect(f.play()).toBe(true); expect(f.offer('respond')).toEqual({ status: 'rejected', reason: 'user_conflict' });
    f.main.handleClick(); f.main.setQuietMode(true);
    expect(f.offer('respond')).toEqual({ status: 'rejected', reason: 'quiet' });
    f.main.setQuietMode(false); f.setMovable(false);
    expect(f.offer('wander')).toEqual({ status: 'rejected', reason: 'forced_motion' }); f.main.dispose();
  });
  it('runs 200 deterministic opportunities with real Needs and bounded diagnostics', () => {
    const f = scenario(); const families = new Set<string>(); const before = f.character.getState().relationship;
    for (let i = 0; i < 200; i++) {
      f.setRandom([.95, .05, .25, .55][i % 4]!);
      f.pulse(); const activity = f.main.getActivityTimeline(); if (activity) families.add(activity.activityId);
      f.finish(); f.advance(1000);
    }
    expect(families.has('calm')).toBe(true); expect(families.has('explore')).toBe(true);
    expect(families.has('zoomies')).toBe(true);
    expect(f.character.getState().relationship).toEqual(before);
    expect(f.main.getDecisionTrace().length).toBeLessThanOrEqual(64);
    expect(f.main.getDecisionTrace().some(row => row.selection?.some(candidate => candidate.score > 0))).toBe(true);
    expect(f.main.getDecisionTrace().some(row => row.activityResult)).toBe(true);
    f.main.dispose();
  });
  it('does not duplicate completed play when a new event ID reuses its run identity', () => {
    const f = scenario(); expect(f.play()).toBe(true); f.arrive(); f.main.handleClick();
    const before = f.character.getState(); const runId = f.outcomes[0]!.activityRunId;
    f.character.applyStimulus({ type: 'play', id: 'new-event', metadata: { activityRunId: runId, deltaMs: 0 } });
    expect(f.character.getState()).toEqual(before); f.main.dispose();
  });
  it('uses a fresh cursor dwell to approach once and then loses interest on stale samples', () => {
    const f = scenario(); f.setRandom(.999);
    f.main.handleCursorObservation({ x: 450, y: 790 });
    for (let i = 0; i < 5; i++) { f.advance(100); f.main.handleCursorObservation({ x: 450, y: 790 }); }
    f.setRandom(0); f.advance(100);
    expect(f.main.handleCursorObservation({ x: 450, y: 790 })).toBe(true);
    expect(f.main.getActivityTimeline()?.activityId).toBe('cursor_interest');
    const runId = f.main.getActivityTimeline()?.runId;
    for (let i = 0; i < 6; i++) { f.main.handleCursorObservation({ x: 470 + i, y: 790 }); f.advance(100); }
    expect(f.main.getActivityTimeline()?.runId).toBe(runId); expect(f.move).toHaveBeenCalledTimes(1);
    expect(Math.abs(f.move.mock.calls[0]![0].targetRootPosition.x - 400)).toBeLessThanOrEqual(160);
    f.advance(301); expect(f.main.getActivityTimeline()).toBeNull();
    expect(f.outcomes[0]?.playCompleted).toBe(false); expect(f.timers.size).toBe(1); f.main.dispose();
  });
  it('returns from AI sleep on timeout without keeping a sleeping local scheduler', () => {
    const f = scenario({ energy: 50 }); expect(f.offer('sleep').status).toBe('admitted');
    f.arrive(); f.advance(1200); f.advance(1500);
    f.advance(20000); expect(f.main.getActivityTimeline()).toBeNull();
    expect(f.main.isSleepingForRecovery()).toBe(false); expect(f.timers.size).toBe(1); f.main.dispose();
  });

  it('allows AI to replace an optional nap but preserves full user sleep', () => {
    const f = scenario({ energy: 50, play: 30, boredom: 20 }, .99); f.pulse();
    expect(f.main.getActivityTimeline()?.activityId).toBe('rest_spot_nap');
    expect(f.offer('respond').status).toBe('admitted');
    expect(f.main.getActivityTimeline()?.activityId).toBe('expression');
    f.main.handleClick(); expect(f.main.requestSleepWake({ action: 'sleep' })).toBe(true);
    expect(f.offer('respond').status).toBe('rejected');
    expect(f.main.getActivityTimeline()?.activityId).toBe('rest_spot_sleep'); f.main.dispose();
  });

});
