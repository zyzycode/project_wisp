import { describe, expect, it, vi } from 'vitest';
import { scenario } from './autonomy-scenario-fixture';

function scene(phase: 'wait' | 'disengage' | 'settle' = 'wait') {
  const started = vi.fn(), social = vi.fn();
  const f = scenario({ attention: 90 }, .999, undefined, undefined,
    { onActivityStarted: started, onSocialBidStarted: social });
  f.pulse();
  for (let i = 0; i < 5 && f.main.getActivityTimeline()?.phaseId !== phase; i++) {
    const timeline = f.main.getActivityTimeline();
    expect(timeline).not.toBeNull();
    f.advance(timeline!.phaseEndsAtMs! - f.now());
  }
  expect(f.main.getActivityTimeline()?.phaseId).toBe(phase);
  return { ...f, started, social };
}

describe('SCENE-I01 local invitation ending', () => {
  it('finishes only after the visible disengage and settle, without another start or reward', () => {
    const f = scene(), runId = f.main.getActivityTimeline()!.runId;
    const relationship = f.character.getState().relationship;
    f.advance(f.main.getActivityTimeline()!.phaseEndsAtMs! - f.now());
    expect(f.main.getActivityTimeline()).toMatchObject({ runId, phaseId: 'disengage', stage: 'exiting' });
    expect(f.main.getVisualEpisode().intent.kind).toBe('look_around');
    f.advance(799); expect(f.outcomes).toHaveLength(0);
    expect(f.main.getActivityTimeline()?.phaseId).toBe('disengage');
    f.advance(1); expect(f.main.getActivityTimeline()?.phaseId).toBe('settle');
    expect(f.main.getVisualEpisode().intent.kind).toBe('settle');
    f.advance(599); expect(f.outcomes).toHaveLength(0);
    f.advance(1); expect(f.main.getActivityTimeline()).toBeNull();
    expect(f.outcomes).toHaveLength(1);
    expect(f.outcomes[0]).toMatchObject({ activityRunId: runId, family: 'social_bid', outcome: 'completed', playCompleted: false });
    f.advance(1000); expect(f.outcomes).toHaveLength(1);
    expect(f.started).toHaveBeenCalledOnce(); expect(f.social).toHaveBeenCalledOnce();
    expect(f.character.getState().relationship).toEqual(relationship);
    f.main.dispose();
  });
  it.each(['wait', 'disengage', 'settle'] as const)('accepted chat cancels %s immediately before async work', phase => {
    const f = scene(phase);
    f.main.acceptDialogueContact();
    expect(f.main.getActivityTimeline()).toBeNull();
    expect(f.outcomes).toHaveLength(1);
    expect(f.outcomes[0]).toMatchObject({ outcome: 'cancelled', playCompleted: false });
    f.advance(10000); expect(f.main.getActivityTimeline()).toBeNull();
    expect(f.outcomes).toHaveLength(1); f.main.dispose();
  });
  it.each(['wait', 'disengage', 'settle'] as const)('pet interrupts %s with the ordinary immediate reaction', phase => {
    const f = scene(phase);
    expect(f.main.handleCharacterInteraction('pet')).toBe(true);
    expect(f.main.getActivityTimeline()).toBeNull();
    expect(f.main.getVisualEpisode().intent.kind).toBe('happy_reaction');
    f.advance(10000); expect(f.main.getActivityTimeline()).toBeNull();
    expect(f.outcomes).toHaveLength(1); f.main.dispose();
  });
  it.each(['quiet', 'quietSupport', 'menu', 'disabled', 'drag', 'forced', 'critical', 'stop', 'dispose'] as const)('cancels the ending for %s without delayed completion', gate => {
    const f = scene('disengage');
    if (gate === 'quiet') f.main.setQuietMode(true);
    if (gate === 'quietSupport') f.main.setQuietSupport(true);
    if (gate === 'menu') f.main.setMenuOpen(true);
    if (gate === 'disabled') f.main.setEnabled(false);
    if (gate === 'drag') f.main.beginDrag();
    if (gate === 'forced') f.main.handleSupportLost();
    if (gate === 'critical') { const state = f.character.getState(); f.character.replaceRestoredState({ ...state, needs: { ...state.needs, energy: 1 } }); f.main.tick(); }
    if (gate === 'stop') f.main.stop();
    if (gate === 'dispose') f.main.dispose();
    expect(f.main.getActivityTimeline()?.activityId).not.toBe('social_bid');
    expect(f.outcomes.filter(event => event.family === 'social_bid')).toHaveLength(1);
    expect(f.outcomes[0]?.outcome).toBe('cancelled');
    f.advance(10000);
    expect(f.outcomes.filter(event => event.family === 'social_bid')).toHaveLength(1);
    f.main.dispose();
  });
});
