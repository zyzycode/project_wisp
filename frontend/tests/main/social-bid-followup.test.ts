import { describe, expect, it, vi } from 'vitest';
import type { SystemIdleLifecycleEvent, SystemIdlePort, SystemIdleReading } from '../../src/application/ports/system-idle.port';
import { scenario } from './autonomy-scenario-fixture';
function fixture() {
  let reading: SystemIdleReading = { status: 'available', idleMs: 1000 };
  let lifecycle: ((event: SystemIdleLifecycleEvent) => void) | undefined;
  const source: SystemIdlePort = { read: () => reading, subscribeLifecycle: listener => { lifecycle = listener; return () => {}; }, dispose: vi.fn() };
  const social = vi.fn(), started = vi.fn(), outcome = vi.fn();
  const f = scenario({ attention: 90 }, .999, undefined, undefined,
    { systemIdle: source, onSocialBidStarted: social, onActivityStarted: started, onActivityOutcome: outcome });
  f.main.tick();
  const step = (ms: number) => { for (let remaining = ms; remaining > 0;) { const next = Math.min(remaining, 1000); f.advance(next); remaining -= next; } };
  const first = () => { const at = [...f.timers.values()][0]!.atMs; step(at - f.now()); f.pulse();
    expect(f.main.getActivityTimeline()?.activityId).toBe('social_bid');
    while (f.main.getActivityTimeline()) step(f.main.getActivityTimeline()!.phaseEndsAtMs! - f.now());
    f.setRandom(0); return f.now(); };
  return { ...f, social, started, outcome, step, first, lifecycle: (event: SystemIdleLifecycleEvent) => lifecycle?.(event),
    reading: (value: SystemIdleReading) => { reading = value; } };
}
describe('SOC-A01 Main lifecycle and admission', () => {
  it('starts one second curious gesture, consumes shared budget, emits no AI start/outcome/learning, then no third', () => {
    const f = fixture(); const terminal = f.first(); const firstCalls = f.started.mock.calls.length;
    expect(f.social).toHaveBeenCalledOnce(); f.step(29999); expect(f.main.getActivityTimeline()).toBeNull();
    f.step(1); expect(f.now()).toBe(terminal + 30000);
    expect(f.main.getActivityTimeline()).toMatchObject({ activityId: 'social_bid', phaseId: 'gesture' });
    expect(f.main.getVisualEpisode().intent).toMatchObject({ kind: 'thinking_loop', expressionHint: 'curious', propHint: 'none' });
    expect(f.social).toHaveBeenCalledOnce(); expect(f.started).toHaveBeenCalledTimes(firstCalls);
    f.step(1200); expect(f.main.getActivityTimeline()).toMatchObject({ phaseId: 'wait' });
    f.step(4000); expect(f.main.getActivityTimeline()).toBeNull();
    expect(f.outcome.mock.calls.filter(([event]) => event.family === 'social_bid')).toHaveLength(1);
    f.step(30000); expect(f.main.spendObservationBudget(f.now())).toBe(false);
    f.step(120000); for (let i = 0; i < 8; i++) { f.pulse(); f.finish(); }
    expect(f.social).toHaveBeenCalledOnce(); f.main.dispose();
  });
  it('evaluates on Utility admission before it can start a new calm run', () => {
    const f = fixture(); f.first(); f.step(29000);
    // Independently scheduled Utility callback advances to its scheduled time before the next Brain tick.
    f.elapse(1000); f.pulse();
    expect(f.main.getActivityTimeline()?.activityId).toBe('social_bid');
    expect(f.main.getVisualEpisode().intent.kind).toBe('thinking_loop');
    expect(f.social).toHaveBeenCalledOnce(); f.main.dispose();
  });
  it('busy calm at opportunity loses candidate without interruption or later retry', () => {
    const f = fixture(); f.first(); f.step(29000); f.pulse();
    expect(f.main.getActivityTimeline()?.activityId).toBe('calm'); const id = f.main.getActivityTimeline()?.runId;
    f.step(1000); expect(f.main.getActivityTimeline()?.runId).toBe(id); f.finish(); f.step(20000);
    expect(f.main.getActivityTimeline()).toBeNull(); expect(f.social).toHaveBeenCalledOnce(); f.main.dispose();
  });
  it.each(['unknown', 'inactive', 'unconfirmed', 'lock', 'quiet', 'support', 'menu', 'disable', 'motion', 'reset', 'stop', 'dialogue', 'critical', 'sleep'] as const)('cancels on %s before window and never revives', gate => {
    const f = fixture(); f.first(); f.step(1000);
    if (gate === 'unknown') f.reading({ status: 'unavailable', reason: 'read_failed' });
    if (gate === 'inactive') f.reading({ status: 'available', idleMs: 60000 });
    if (gate === 'unconfirmed') f.reading({ status: 'unavailable', reason: 'unconfirmed' });
    if (gate === 'lock') f.lifecycle('lock');
    if (gate === 'quiet') f.main.setQuietMode(true);
    if (gate === 'support') f.main.setQuietSupport(true);
    if (gate === 'menu') f.main.setMenuOpen(true);
    if (gate === 'disable') f.main.setEnabled(false);
    if (gate === 'motion') { f.setMovable(false); f.main.handleSupportLost(); }
    if (gate === 'reset') f.main.resetSystemIdle();
    if (gate === 'stop') { f.main.stop(); f.main.start(); }
    if (gate === 'dialogue') f.main.invalidateSocialFollowup();
    if (gate === 'sleep') f.main.requestSleepWake({ action: 'sleep' });
    if (gate === 'critical') { const state = f.character.getState(); f.character.replaceRestoredState({ ...state, needs: { ...state.needs, energy: 1 } }); }
    f.step(1000); f.reading({ status: 'available', idleMs: 1000 }); f.lifecycle('unlock');
    f.main.setQuietMode(false); f.main.setQuietSupport(false); f.main.setMenuOpen(false); f.main.setEnabled(true); f.setMovable(true);
    f.step(45000); expect(f.main.getActivityTimeline()?.activityId).not.toBe('social_bid');
    for (let i = 0; i < 3; i++) { f.pulse(); f.finish(); }
    expect(f.social).toHaveBeenCalledOnce(); f.main.dispose();
  });
  it('accepted contact permits a fresh first; rejected pet preserves the silence latch', () => {
    const f = fixture(); f.first(); f.setMovable(false); expect(f.main.handleCharacterInteraction('pet')).toBe(false);
    f.setMovable(true); f.step(120000); f.pulse(); expect(f.main.getActivityTimeline()?.activityId).not.toBe('social_bid'); f.finish();
    expect(f.main.handleCharacterInteraction('pet')).toBe(true); f.step(5000); f.setRandom(.999); f.pulse();
    expect(f.social).toHaveBeenCalledTimes(2); f.main.dispose();
  });
  it('accepted chat before async clears chain, while thinking blocks second until reset', () => {
    const f = fixture(); f.first(); f.step(29000); f.main.acceptDialogueContact(); f.step(1000);
    expect(f.main.getActivityTimeline()).toBeNull(); f.main.invalidateSocialFollowup(); f.step(120000); f.setRandom(.999); f.pulse();
    expect(f.social).toHaveBeenCalledTimes(2); f.main.dispose();
  });
  it('budget exhaustion loses second even after the ledger opens another window', () => {
    const f = fixture(); f.first(); f.step(25000); expect(f.main.spendObservationBudget(f.now())).toBe(true);
    f.step(5000); expect(f.main.getActivityTimeline()).toBeNull(); f.step(120000);
    expect(f.main.getActivityTimeline()).toBeNull(); f.main.dispose();
  });
  it('full memory reset clears latch; reset/reload alone preserves it', () => {
    const f = fixture(); f.first(); f.main.invalidateSocialFollowup(); f.step(120000); f.setRandom(.999); f.pulse(); f.finish();
    expect(f.social).toHaveBeenCalledOnce(); f.main.resetSocialFollowupMemory(); f.setRandom(.999); f.pulse();
    expect(f.social).toHaveBeenCalledTimes(2); f.main.dispose();
  });
});

it.each([30000, 60000])('loses stale/gap opportunity at %d and never catches up', gap => {
  const f = fixture(); f.first(); f.elapse(gap); f.main.tick(); f.step(4000);
  expect(f.main.getActivityTimeline()).toBeNull(); expect(f.social).toHaveBeenCalledOnce(); f.main.dispose();
});
it('drops probability equality once and never redraws as time advances', () => {
  const f = fixture(); f.first(); f.setRandom(1 / 3); f.step(30000);
  expect(f.main.getActivityTimeline()).toBeNull(); f.setRandom(0); f.step(20000);
  expect(f.main.getActivityTimeline()).toBeNull(); expect(f.social).toHaveBeenCalledOnce(); f.main.dispose();
});
it('accepted chat may finish idle without provider; a later fresh first can still get second', () => {
  const f = fixture(); f.first(); f.main.acceptDialogueContact();
  f.main.observeDialoguePresentation({ conversationId: 'c', canSubmit: true, turn: { phase: 'idle' } });
  f.step(120000); f.setRandom(.999); f.pulse(); expect(f.social).toHaveBeenCalledTimes(2);
  while (f.main.getActivityTimeline()) f.step(f.main.getActivityTimeline()!.phaseEndsAtMs! - f.now());
  f.setRandom(0); f.step(30000); expect(f.main.getVisualEpisode().intent.kind).toBe('thinking_loop'); f.main.dispose();
});
it('actual start latches before visual callbacks, accepted reentrant contact cancels linkage without late rearming', () => {
  let main: ReturnType<typeof scenario>['main'] | undefined, contacts = 0;
  const f = scenario({ attention: 90 }, .999, undefined, undefined, { onPresentationChanged: () => {
    if (main?.getActivityTimeline()?.activityId === 'social_bid' && contacts === 0) { contacts++; main.acceptUserContact(); }
  } }); main = f.main;
  f.pulse(); f.finish(); f.advance(120000); f.pulse();
  expect(contacts).toBe(1); expect(f.main.getActivityTimeline()?.activityId).toBe('social_bid'); f.main.dispose();
});
