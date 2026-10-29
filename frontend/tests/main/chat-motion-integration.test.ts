import { describe, expect, it, vi } from 'vitest';
import { MainAutonomyComposition } from '../../src/main/main-autonomy-composition';
import type { CharacterAutonomySnapshot } from '../../src/domain/character';

function setup() {
  let now = 0, id = 0, movable = true;
  let root = { x: 400, y: 790 };
  let snapshot: CharacterAutonomySnapshot = { needs: { energy: 70, comfort: 15, attention: 40, play: 50, boredom: 30 }, synthesizedTone: 'neutral' };
  const bounds = { id: 'screen', x: 0, y: 0, width: 1000, height: 800 };
  const surface = { id: 'floor', kind: 'screen_floor' as const, bounds, isValidSupport: true };
  const terminal = vi.fn(), outcome = vi.fn();
  const movement = vi.fn(() => true), cancel = vi.fn(() => true);
  const main = new MainAutonomyComposition({ clock: { now: () => now },
    scheduler: { setTimeout: () => 1, clearTimeout: () => {} }, prng: { next: () => .5 },
    prngMetadata: { algorithm: 'constant', seed: 1 }, getCharacterSnapshot: () => snapshot,
    movement: { getRootPosition: () => root, getBounds: () => bounds,
      getEnvironmentSnapshot: () => ({ capturedAtMs: now, screenBounds: bounds, currentSurface: surface }),
      getCollisionInsets: () => ({ left: 10, right: 10, top: 80, bottom: 10 }),
      canAcceptVoluntaryMovement: () => movable, requestVoluntaryMovement: movement, cancelVoluntaryMovement: cancel },
    requestManualRootPosition: () => false, createVisualEpisodeId: () => `v${++id}`, createActivityRunId: () => `r${++id}`,
    onPresentationChanged: () => {}, onChatMotionTerminal: terminal, onActivityOutcome: outcome });
  main.start();
  const request = (direction: 'left' | 'right' | 'stop' = 'left') => main.submitChatMotion({ requestId: `q${++id}`, conversationId: 'c', generation: 0,
    command: direction === 'stop' ? { kind: 'stop' } : { kind: 'move', direction } });
  return { main, movement, cancel, terminal, outcome, request, surface,
    setNeeds: (energy: number, comfort = 15) => { snapshot = { ...snapshot, needs: { ...snapshot.needs, energy, comfort } }; },
    setRoot: (x: number) => { root = { ...root, x }; }, setMovable: (value: boolean) => { movable = value; },
    tick: (delta = 1) => { now += delta; main.tick(); } };
}

describe('local chat requests through Main/Activity/Motion', () => {
  it('starts one fixed screen-relative walk and confirms only its runner terminal', () => {
    const s = setup(), receipt = s.request('left');
    expect(receipt.status).toBe('started');
    expect(s.movement).toHaveBeenLastCalledWith(expect.objectContaining({ targetRootPosition: { x: 240, y: 790 }, activity: expect.objectContaining({ runId: expect.any(String), stepId: 'walk' }) }));
    const runtime = s.main.getActivityTimeline()!;
    s.main.notifyVoluntaryMovementCompleted();
    expect(s.main.getActivityTimeline()?.runId).toBe(runtime.runId);
    s.main.notifyVoluntaryMovementCompleted({ runId: 'retired', stepId: 'walk' });
    expect(s.main.getActivityTimeline()?.runId).toBe(runtime.runId);
    s.main.notifyVoluntaryMovementCompleted({ runId: runtime.runId, stepId: runtime.phaseId });
    expect(s.terminal).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', runId: runtime.runId }));
    expect(s.outcome).not.toHaveBeenCalled();
  });
  it('replaces direction and stop releases only chat ownership', () => {
    const s = setup(); s.request('left'); const old = s.main.getActivityTimeline()!;
    s.setRoot(380); s.request('right');
    expect(s.movement).toHaveBeenLastCalledWith(expect.objectContaining({ targetRootPosition: { x: 540, y: 790 } }));
    expect(s.terminal).toHaveBeenCalledWith(expect.objectContaining({ runId: old.runId, status: 'cancelled', reason: 'replaced' }));
    expect(s.request('stop')).toMatchObject({ status: 'stopped', hadActiveRun: true });
    expect(s.main.getActivityTimeline()).toBeNull();
    expect(s.request('stop')).toMatchObject({ status: 'stopped', hadActiveRun: false });
  });
  it.each([[20, 15, 'low_energy'], [21, 80, 'overloaded']] as const)('refuses current needs %s/%s', (energy, comfort, reason) => {
    const s = setup(); s.setNeeds(energy, comfort);
    expect(s.request()).toMatchObject({ status: 'rejected', reason }); expect(s.movement).not.toHaveBeenCalled();
  });
  it('allows just above vital thresholds and refuses semantic sleep without waking', () => {
    const s = setup(); s.setNeeds(21, 79); expect(s.request().status).toBe('started'); s.request('stop');
    expect(s.main.requestSleepWake({ action: 'sleep' })).toBe(true);
    expect(s.request()).toMatchObject({ status: 'rejected', reason: 'sleeping' });
    expect(s.main.getActivityTimeline()?.activityId).toBe('rest_spot_sleep');
  });
  it('cancels on critical need and proceeds into existing sleep', () => {
    const s = setup(); s.request(); s.setNeeds(20); s.tick();
    expect(s.terminal).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', reason: 'critical_need' }));
    expect(s.main.getActivityTimeline()?.activityId).toBe('rest_spot_sleep');
  });
  it('refuses edge, lost support and forced motion', () => {
    const s = setup(); s.setRoot(10); expect(s.request()).toMatchObject({ status: 'rejected', reason: 'edge' });
    s.surface.isValidSupport = false; expect(s.request()).toMatchObject({ status: 'rejected', reason: 'no_support' });
    s.setMovable(false); expect(s.request()).toMatchObject({ status: 'rejected', reason: 'forced_motion' });
  });
  it('cancels on changed geometry, drag, timeout and dispose', () => {
    const s = setup(); s.request(); s.surface.bounds.width = 900; s.tick();
    expect(s.terminal).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'environment_changed' }));
    s.request(); s.main.beginDrag(); expect(s.terminal).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'cancelled' }));
    s.request(); s.tick(7001); expect(s.terminal).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'timeout' }));
    s.request(); s.main.dispose(); expect(s.terminal).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'disposed' }));
  });
  it('does not cancel for refreshed environment timestamps', () => {
    const s = setup(); s.request(); s.tick(100); expect(s.main.getActivityTimeline()?.activityId).toBe('chat_walk');
    expect(s.terminal).not.toHaveBeenCalled();
  });
});
