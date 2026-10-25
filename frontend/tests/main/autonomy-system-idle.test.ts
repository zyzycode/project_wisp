import { describe, expect, it, vi } from 'vitest';
import type { SystemIdleLifecycleEvent, SystemIdlePort, SystemIdleReading } from '../../src/application/ports/system-idle.port';
import { scenario } from './autonomy-scenario-fixture';

function idleFixture() {
  let reading: SystemIdleReading = { status: 'available', idleMs: 1000 };
  let listener: ((event: SystemIdleLifecycleEvent) => void) | undefined;
  const source: SystemIdlePort = { read: vi.fn(() => reading), subscribeLifecycle: callback => {
    listener = callback; return vi.fn(); }, dispose: vi.fn() };
  const social = vi.fn(), unsolicited = vi.fn();
  const f = scenario({ attention: 90 }, 0, undefined, undefined,
    { systemIdle: source, onSocialBidStarted: social, onUnsolicitedBlocked: unsolicited });
  f.main.tick();
  const sample = (idleMs: number) => { reading = { status: 'available', idleMs }; f.advance(1000); };
  const away = () => { for (let seconds = 2; seconds <= 301; seconds++) sample(seconds * 1000); };
  return { ...f, source, social, unsolicited, sample, away, lifecycle: (event: SystemIdleLifecycleEvent) => listener?.(event),
    unavailable: () => { reading = { status: 'unavailable', reason: 'unconfirmed' }; f.advance(1000); } };
}

describe('system idle local initiative integration', () => {
  it('suppresses only unsolicited eligibility while probably away', () => {
    const f = idleFixture(); f.away();
    expect(f.main.getAIEventState()).toMatchObject({ allowed: false, touchAllowed: true });
    expect(f.unsolicited).toHaveBeenCalledOnce(); f.main.dispose();
  });
  it('starts exactly one stationary return through the shared runner without an AI callback', () => {
    const f = idleFixture(); f.away(); f.sample(1000);
    expect(f.main.getActivityTimeline()?.activityId).toBe('social_bid');
    expect(f.move).not.toHaveBeenCalled(); expect(f.social).not.toHaveBeenCalled();
    const firstRun = f.main.getActivityTimeline()?.runId; f.sample(2000);
    expect(f.main.getActivityTimeline()?.runId).toBe(firstRun); f.finish(); f.sample(1000);
    expect(f.main.getActivityTimeline()).toBeNull(); f.main.dispose();
  });
  it.each(['quiet', 'menu', 'disabled', 'critical', 'user', 'provider', 'motion'] as const)('drops return under %s without replay when the gate opens', gate => {
    const f = idleFixture(); f.away();
    if (gate === 'quiet') f.main.setQuietMode(true);
    if (gate === 'menu') f.main.setMenuOpen(true);
    if (gate === 'disabled') f.main.setEnabled(false);
    if (gate === 'critical') { const state = f.character.getState(); f.character.replaceRestoredState({ ...state, needs: { ...state.needs, energy: 1 } }); }
    if (gate === 'user') f.main.suspendForUserInteraction();
    if (gate === 'provider') expect(f.offer('think').status).toBe('admitted');
    if (gate === 'motion') f.setMovable(false);
    f.sample(1000); expect(f.main.getActivityTimeline()?.activityId).not.toBe('social_bid');
    f.main.setQuietMode(false); f.main.setMenuOpen(false); f.main.setEnabled(true); f.setMovable(true);
    f.main.resumeAfterUserInteraction(); f.finish(); f.sample(2000);
    expect(f.main.getActivityTimeline()?.activityId).not.toBe('social_bid'); f.main.dispose();
  });
  it('spends the same initiative budget as observation and drops a return when exhausted', () => {
    const f = idleFixture(); f.away(); expect(f.main.spendObservationBudget(f.now())).toBe(true);
    f.sample(1000); expect(f.main.getActivityTimeline()).toBeNull(); f.advance(30000); f.sample(1000);
    expect(f.main.getActivityTimeline()).toBeNull(); f.main.dispose();
  });
  it('charges return once and cancels a safe calm run without enabling a second cursor episode', () => {
    const f = idleFixture(); f.away(); f.pulse(); expect(f.main.getActivityTimeline()?.activityId).toBe('calm');
    f.sample(1000); expect(f.main.getActivityTimeline()?.activityId).toBe('social_bid');
    expect(f.main.spendObservationBudget(f.now())).toBe(false);
    for (let i = 0; i < 6; i++) { f.advance(100); f.main.handleCursorObservation({ x: 440, y: 790 }); }
    expect(f.main.getActivityTimeline()?.activityId).toBe('social_bid'); f.main.dispose();
  });
  it('keeps cursor reactions gaze-only while away, and never starts an unsolicited game', () => {
    const f = idleFixture(); f.away();
    for (let i = 0; i < 8; i++) { f.advance(100); f.main.handleCursorObservation({ x: 440, y: 790 }); }
    expect(f.main.getActivityTimeline()?.activityId).not.toBe('cursor_interest');
    expect(f.move).not.toHaveBeenCalled(); f.main.dispose();
  });
  it('drops armed return on renderer stream reset while keeping the source available', () => {
    const f = idleFixture(); f.away(); f.main.resetSystemIdle(); f.sample(1000);
    expect(f.main.getActivityTimeline()).toBeNull(); expect(f.source.dispose).not.toHaveBeenCalled();
    expect(f.main.getAIEventState().allowed).toBe(true); f.main.dispose();
  });
  it('allows direct user play and provider reply while away, without new unsolicited SocialBid', () => {
    const f = idleFixture(); f.away(); expect(f.play()).toBe(true); f.finish();
    f.sample(302000); f.sample(303000); expect(f.offer('think').status).toBe('admitted');
    expect(f.main.getActivityTimeline()?.activityId).toBe('expression'); f.main.dispose();
  });
  it('cancels an active unsolicited social run on lock without negative feedback or AI invalidation', () => {
    const f = idleFixture(); f.away(); f.sample(1000); expect(f.main.getActivityTimeline()?.activityId).toBe('social_bid');
    const friendship = f.character.getState().relationship.friendship;
    f.lifecycle('lock'); expect(f.main.getActivityTimeline()).toBeNull();
    expect(f.character.getState().relationship.friendship).toBe(friendship);
    expect(f.outcomes.at(-1)).toMatchObject({ family: 'social_bid', outcome: 'cancelled', playCompleted: false }); f.main.dispose();
  });
});
