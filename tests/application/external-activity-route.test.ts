import { describe, expect, it } from 'vitest';
import { BrainActivityRuntime } from '../../src/application/services/brain-activity-runtime';
import { ShimejiMotionOrchestrator } from '../../src/application/services/shimeji-motion-orchestrator';
import { MotionEngine } from '../../src/domain/behavior/motion-engine';
import { SurfaceKinematics, type ExternalWindowSurface } from '../../src/domain/behavior/surface-kinematics';
import type { ExternalWindowSurfacesSnapshot } from '../../src/application/ports/external-window-surfaces.port';
import type { BehaviorIntent } from '../../src/domain/behavior/behavior-intent';
function fixture() {
  let now = 0, revision = 0, available = true;
  let top: ExternalWindowSurface = { id: 'window', kind: 'window_top', bounds: { x: 300, y: 400, width: 300, height: 200 }, supportY: 400, isValidSupport: true };
  const bounds = { id: 'screen', x: 0, y: 0, width: 1000, height: 800 };
  const insets = { left: 50, right: 50, top: 90, bottom: 10 };
  const snapshot = { needs: { energy: 60, attention: 20, play: 20, comfort: 20, boredom: 50 }, synthesizedTone: 'neutral' as const };
  const visual: string[] = [], outcomes: string[] = [], events: string[] = [];
  let activity: BrainActivityRuntime;
  const motion = new ShimejiMotionOrchestrator({
    initialMotion: { phase: 'grounded', position: { x: 100, y: 790 }, velocityPxPerSec: { x: 0, y: 0 }, activeBoundsId: 'screen', airborneElapsedSec: 0, peakGroundImpactSeverity: 0 },
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
    move: () => { top = { ...top, kind: 'window_top', side: undefined, bounds: { ...top.bounds, x: 320 }, supportY: 400 }; },
  };
}
const explore: BehaviorIntent = { kind: 'wander', source: 'timer', priority: 'normal', reason: 'test' };
const nap: BehaviorIntent = { kind: 'sleep', source: 'timer', priority: 'high', reason: 'autonomous_nap' };
describe('AUTO-I06 Activity → real Motion integration', () => {
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
