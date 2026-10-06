import { describe, expect, it } from 'vitest';
import { MainAutonomyComposition } from '../../src/main/main-autonomy-composition';
import { ShimejiMotionOrchestrator } from '../../src/application/services/shimeji-motion-orchestrator';
import { DEFAULT_MOTION_CONSTRAINTS, MotionEngine } from '../../src/domain/behavior/motion-engine';
import { SurfaceKinematics } from '../../src/domain/behavior/surface-kinematics';

function fixture() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, () => void>();
  const bounds = { id: 'screen', x: 0, y: 0, width: 1000, height: 800 };
  const environment = { capturedAtMs: 0, screenBounds: bounds,
    currentSurface: { id: 'floor', kind: 'screen_floor' as const, bounds, isValidSupport: true } };
  let main: MainAutonomyComposition;
  const motion = new ShimejiMotionOrchestrator({
    initialMotion: { phase: 'grounded', position: { x: 200, y: 790 }, velocityPxPerSec: { x: 0, y: 0 },
      activeBoundsId: 'screen', airborneElapsedSec: 0, peakGroundImpactSeverity: 0 },
    initialSurface: { phase: 'grounded', updatedAtMs: 0, locomotionVelocityPxPerSec: { x: 0, y: 0 } },
    now: () => now, motionEngine: new MotionEngine(), surfaceKinematics: new SurfaceKinematics(),
    environment: () => environment, positionPort: { commitRootPosition: () => {} },
    eventDispatcher: { dispatchMotionEvent: e => main.handleMotionEvent(e),
      dispatchSurfaceEvent: e => { if (e.type === 'support_lost') main.handleSupportLost(); } },
    onTraversalRejected: request => main.notifyTraversalRejected(request),
    onVoluntaryMovementCompleted: completed => main.notifyVoluntaryMovementCompleted(completed),
  });
  const random = [0, .2, .35, .5, 0];
  let episode = 0;
  main = new MainAutonomyComposition({
    clock: { now: () => now }, scheduler: {
      setTimeout: callback => { timers.set(++nextId, callback); return nextId; },
      clearTimeout: id => { timers.delete(id as number); },
    },
    prng: { next: () => random.shift() ?? .5 }, prngMetadata: { algorithm: 'fixture', seed: 1 },
    getCharacterSnapshot: () => ({ needs: { energy: 90, boredom: 80, play: 60, comfort: 20, attention: 20 }, synthesizedTone: 'neutral' }),
    movement: {
      getRootPosition: () => motion.getMotionState().position, getBounds: () => bounds,
      getEnvironmentSnapshot: () => environment, getCollisionInsets: () => DEFAULT_MOTION_CONSTRAINTS.collisionInsets,
      canAcceptVoluntaryMovement: () => motion.canAcceptVoluntaryMovement(),
      requestVoluntaryMovement: command => motion.requestVoluntaryMovement(command),
      requestTraversal: request => motion.requestTraversal(request),
      cancelVoluntaryMovement: forDrag => motion.cancelVoluntaryMovement(forDrag),
    },
    requestManualRootPosition: () => false, createVisualEpisodeId: () => `episode-${++episode}`,
    onPresentationChanged: () => {},
    behaviorConfig: { minIdleDurationMs: 10, maxIdleDurationMs: 10, minWanderDurationMs: 20,
      maxWanderDurationMs: 1000, wanderSpeedPxPerSec: 100, napProbability: .15, maxWanderDistancePx: 100 },
  });
  motion.start(); main.start();
  const initial = [...timers.entries()][0]!;
  timers.delete(initial[0]); now = 10; motion.tick(); initial[1]();
  const phases: string[] = [];
  const visuals: string[] = [];
  function advance(ms: number) {
    for (let i = 0; i < ms / 10; i++) {
      now += 10; motion.tick(); main.tick();
      const phase = main.getActivityTimeline()?.phaseId;
      if (phase !== undefined && phases.at(-1) !== phase) phases.push(phase);
      const visual = main.getVisualEpisode().intent.kind;
      if (visuals.at(-1) !== visual) visuals.push(visual);
    }
  }
  return { main, motion, advance, phases, visuals, timers };
}

describe('AUTO-I04 Brain → Motion integration', () => {
  it('runs the route under one Activity, shows jump/fall/land and resumes cadence once', () => {
    const f = fixture();
    expect(f.main.getActivityTimeline()?.phaseId).toBe('approach');
    const goal = f.main.getExplorePlan()!.targetRootPosition;
    const runId = f.main.getActivityTimeline()!.runId;
    f.advance(12000);
    expect(f.phases).toEqual(['approach', 'grab_edge', 'climb', 'jump_travel', 'route_land', 'inspect', 'pose', 'leave_pose']);
    expect(f.visuals).toEqual(expect.arrayContaining(['grab_edge', 'climb_wall', 'jump_travel', 'fall', 'land']));
    expect(f.motion.getMotionState().position).toEqual(goal);
    f.advance(6000);
    expect(f.main.getActivityTimeline()).toBeNull();
    expect(f.timers.size).toBe(1);
    f.main.notifyVoluntaryMovementCompleted({ runId, stepId: 'jump_travel' });
    expect(f.main.getActivityTimeline()).toBeNull();
    expect(f.timers.size).toBe(1);
  });

  it.each(['menu', 'click', 'disable', 'drag', 'shutdown'] as const)('%s cancels an attached Activity without resurrecting it', reason => {
    const f = fixture();
    f.advance(2500);
    expect(f.main.getActivityTimeline()?.phaseId).toBe('climb');
    if (reason === 'menu') f.main.setMenuOpen(true);
    if (reason === 'click') f.main.handleClick();
    if (reason === 'disable') f.main.setEnabled(false);
    if (reason === 'shutdown') { f.main.stop(); f.motion.stop(); }
    if (reason === 'drag') {
      f.main.beginDrag();
      f.motion.beginDrag({ pointerId: 1, sequence: 0, screenPosition: f.motion.getMotionState().position });
    }
    expect(f.main.getActivityTimeline()).toBeNull();
    if (reason !== 'drag' && reason !== 'shutdown') expect(f.main.getVisualEpisode().intent.kind).toBe('fall');
    f.advance(5000);
    expect(f.main.getActivityTimeline()).toBeNull();
    expect(f.motion.getMotionState().phase).toBe(reason === 'drag' ? 'dragged' : reason === 'shutdown' ? 'airborne' : 'grounded');
  });
});
