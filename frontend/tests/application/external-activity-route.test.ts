import { describe, expect, it } from 'vitest';
import { BrainActivityRuntime } from '../../src/application/services/brain-activity-runtime';
import { ShimejiMotionOrchestrator } from '../../src/application/services/shimeji-motion-orchestrator';
import { MotionEngine } from '../../src/domain/behavior/motion-engine';
import { SurfaceKinematics, type ExternalWindowSurface } from '../../src/domain/behavior/surface-kinematics';
import type { ExternalWindowSurfacesSnapshot } from '../../src/application/ports/external-window-surfaces.port';
import type { BehaviorIntent } from '../../src/domain/behavior/behavior-intent';
function fixture(detour = false) {
  let now = 0, revision = 0, available = true;
  let top: ExternalWindowSurface = detour
    ? { id: 'window', kind: 'window_top', bounds: { x: 300, y: 250, width: 900, height: 600 }, supportY: 250, isValidSupport: true }
    : { id: 'window', kind: 'window_top', bounds: { x: 300, y: 400, width: 300, height: 200 }, supportY: 400, isValidSupport: true };
  const bounds = { id: 'screen', x: 0, y: 0, width: detour ? 1920 : 1000, height: detour ? 1080 : 800 };
  const insets = { left: 50, right: 50, top: 90, bottom: 10 };
  const snapshot = { needs: { energy: 60, attention: 20, play: 20, comfort: 20, boredom: 50 }, synthesizedTone: 'neutral' as const };
  const visual: string[] = [], outcomes: string[] = [], events: string[] = [];
  let activity: BrainActivityRuntime;
  const motion = new ShimejiMotionOrchestrator({
    initialMotion: { phase: 'grounded', position: detour ? { x: 650, y: 1070 } : { x: 100, y: 790 }, velocityPxPerSec: { x: 0, y: 0 }, activeBoundsId: 'screen', airborneElapsedSec: 0, peakGroundImpactSeverity: 0 },
    initialSurface: { phase: 'grounded', updatedAtMs: 0, locomotionVelocityPxPerSec: { x: 0, y: 0 } },
    motionEngine: new MotionEngine(), surfaceKinematics: new SurfaceKinematics(), now: () => now,
    positionPort: { commitRootPosition: () => {} },
    environment: () => ({ capturedAtMs: now, screenBounds: bounds, currentSurface: { id: 'floor', kind: 'screen_floor', bounds, isValidSupport: true } }),
    externalWindows: { getSnapshot: (): ExternalWindowSurfacesSnapshot => available ? { capability: 'available', revision: ++revision, capturedAtMs: now, surfaces: [top] }
      : { capability: 'unavailable', revision: ++revision, capturedAtMs: now, reason: 'bridge_failed', surfaces: [] }, subscribe: () => () => {}, dispose: () => {} },
    onVoluntaryMovementCompleted: done => activity.notifyLocomotionCompleted(done),
    onTraversalRejected: () => activity.cancel('environment_invalidated'),
    eventDispatcher: { dispatchMotionEvent: e => events.push(e.type), dispatchSurfaceEvent: e => { events.push(e.type); if (e.type === 'support_lost') activity.cancel('forced_motion'); } },
  });
  activity = new BrainActivityRuntime({ clock: { now: () => now }, getCharacterSnapshot: () => snapshot,
    getSelectionContext: () => ({ character: snapshot, synthesizedTone: 'neutral', environment: motion.getEnvironmentSnapshot() }),
    getRootPosition: () => motion.getMotionState().position, getCollisionInsets: () => insets,
    getExternalSurfaces: () => motion.availableExternalSurfaces(), nextRandom: () => .999, traversalEnabled: true,
    requestLocomotion: r => r.traversal ? motion.requestTraversal({ runId: r.runId, stepId: r.stepId, action: r.traversal })
      : motion.requestVoluntaryMovement({ kind: 'horizontal_wander', targetRootPosition: r.targetRootPosition!, speedPxPerSec: 100 }),
    cancelLocomotion: drag => motion.cancelVoluntaryMovement(drag), createRunId: () => 'run-1',
    onVisualIntent: i => visual.push(i.kind), onTerminated: r => outcomes.push(r.status),
  });
  motion.start();
  return { motion, activity, visual, events, outcomes,
    start: (intent: BehaviorIntent) => activity.start(intent),
    advance: (ms: number) => { for (let i = 0; i < ms / 10; i++) { now += 10; motion.tick(); activity.tick(now); } },
    lose: () => { available = false; }, recover: () => { available = true; },
    move: () => { top = { ...top, kind: 'window_top', side: undefined, bounds: { ...top.bounds, x: 320 }, supportY: top.bounds.y }; },
  };
}
const explore: BehaviorIntent = { kind: 'wander', source: 'timer', priority: 'normal', reason: 'test' };
const nap: BehaviorIntent = { kind: 'sleep', source: 'timer', priority: 'high', reason: 'autonomous_nap' };
describe('AUTO-I06 Activity → real Motion integration', () => {
  it.each([explore, nap])('reaches the tall intervening window through a side detour for $kind', intent => {
    const f = fixture(true);
    expect(f.start(intent)).toBe(true);
    const goal = f.activity.getExplorePlan();
    expect(goal?.surfaceKind).toBe('window_top');
    expect(goal!.distancePx).toBeGreaterThan(500);
    f.advance(45000);
    expect(f.visual).toContain('climb_wall');
    expect(f.visual).toContain('grab_edge');
    expect(f.visual).toContain('jump_travel');
    expect(f.visual).toContain('pull_up_edge');
    expect(f.motion.getSurfaceState().externalAttachment?.surface.id).toBe('window');
    expect(f.motion.getMotionState().position).toEqual(goal?.targetRootPosition);
    expect(f.outcomes).toEqual(['completed']);
  });

  it('loses the target during the detour climb and falls without a jump or reattachment', () => {
    const f = fixture(true); f.start(explore); f.advance(7000);
    expect(f.motion.getSurfaceState().phase).toBe('climbing_wall');
    f.lose(); f.advance(20);
    expect(f.activity.getRuntime()).toBeNull();
    expect(f.motion.getMotionState().phase).toBe('airborne');
    f.recover(); f.advance(8000);
    expect(f.visual).not.toContain('jump');
    expect(f.motion.getSurfaceState().externalAttachment).toBeUndefined();
  });

  it.each([1000, 7000])('cancels user interaction at %s ms of the detour without reaching the window', ms => {
    const f = fixture(true); f.start(explore); f.advance(ms);
    expect(f.activity.cancel('user_interaction')).toBe(true);
    f.advance(15000);
    expect(f.activity.getRuntime()).toBeNull();
    expect(f.motion.getSurfaceState().externalAttachment).toBeUndefined();
    expect(f.motion.getMotionState().phase).toBe('grounded');
    expect(f.visual).not.toContain('jump');
  });

  it('uses a support-local target while walking after the detour landing', () => {
    const f = fixture(true); f.start(explore);
    const goal = f.activity.getExplorePlan()!;
    f.advance(12000);
    expect(f.activity.getRuntime()?.currentStepId).toBe('walk_support');
    expect(f.motion.getSurfaceState().externalAttachment).toBeDefined();
    f.move(); f.advance(20000);
    expect(f.motion.getMotionState().position).toEqual({ x: goal.targetRootPosition.x + 20, y: goal.targetRootPosition.y });
    expect(f.outcomes).toEqual(['completed']);
  });
  it('scores a window goal, reaches it through a jump, inspects and exits one Activity', () => {
    const f = fixture(); expect(f.start(explore)).toBe(true);
    expect(f.activity.getExplorePlan()?.surfaceKind).toBe('window_top');
    f.advance(10000);
    expect(f.motion.getSurfaceState().externalAttachment?.surface.id).toBe('window');
    expect(f.visual).toContain('land');
    expect(f.visual.some(v => ['look_around', 'crouch_examine', 'edge_peek', 'surface_touch'].includes(v))).toBe(true);
    expect(f.outcomes).toEqual(['completed']);
  });
  it('reaches a rest spot, follows a small move and completes a bounded nap', () => {
    const f = fixture(); expect(f.start(nap)).toBe(true); f.advance(3000);
    expect(f.motion.getSurfaceState().externalAttachment).toBeDefined();
    const x = f.motion.getMotionState().position.x; f.move(); f.advance(10);
    expect(f.motion.getMotionState().position.x).toBeCloseTo(x + 20);
    f.advance(20000); expect(f.outcomes).toEqual(['completed']);
    expect(f.visual.some(v => v === 'wake_up' || v === 'stand_up')).toBe(true);
  });
  it('invalidates a disappearing airborne goal, falls and never performs inspection or reattaches', () => {
    const f = fixture(); f.start(explore); f.advance(100); f.lose(); f.advance(20); f.recover(); f.advance(4000);
    expect(f.activity.getRuntime()).toBeNull();
    expect(f.motion.getMotionState().phase).toBe('grounded');
    expect(f.motion.getSurfaceState().externalAttachment).toBeUndefined();
    expect(f.visual).not.toContain('look_around');
  });
  it.each(['user_interaction', 'environment_invalidated', 'application_shutdown'] as const)('cancels %s during a route into safe fall', reason => {
    const f = fixture(); f.start(explore); f.advance(100); f.activity.cancel(reason); f.advance(4000);
    expect(f.motion.getMotionState().phase).toBe('grounded'); expect(f.activity.getRuntime()).toBeNull();
    expect(f.motion.getSurfaceState().externalAttachment).toBeUndefined();
  });
});
