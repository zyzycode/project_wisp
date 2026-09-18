import { afterEach, expect, it, vi } from 'vitest';
import { MainAutonomyComposition } from '../../src/main/main-autonomy-composition';
import { ShimejiMotionOrchestrator } from '../../src/application/services/shimeji-motion-orchestrator';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { DEFAULT_MOTION_CONSTRAINTS, MotionEngine } from '../../src/domain/behavior/motion-engine';
import { SurfaceKinematics } from '../../src/domain/behavior/surface-kinematics';
import { LANDING_RECOVERY_MS } from '../../src/domain/behavior/autonomous-behavior';

afterEach(() => vi.useRealTimers());

it.each([0, .2, .5, .9])('resumes an activity after a real drag and landing (random %s)', random => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const bounds = { id: 'screen', x: 0, y: 0, width: 1920, height: 1040 };
  const character = new CharacterStateService({ now: Date.now });
  let main: MainAutonomyComposition, sequence = 0;
  let recoveryAtMs: number | undefined;
  const motion = new ShimejiMotionOrchestrator({
    initialMotion: { phase: 'grounded', position: { x: 800, y: 1030 },
      velocityPxPerSec: { x: 0, y: 0 }, activeBoundsId: bounds.id,
      airborneElapsedSec: 0, peakGroundImpactSeverity: 0 },
    initialSurface: { phase: 'grounded', updatedAtMs: 0, locomotionVelocityPxPerSec: { x: 0, y: 0 } },
    motionEngine: new MotionEngine(), surfaceKinematics: new SurfaceKinematics(), now: Date.now,
    environment: () => ({ capturedAtMs: Date.now(), screenBounds: bounds,
      currentSurface: { id: 'floor', kind: 'screen_floor', bounds, isValidSupport: true } }),
    positionPort: { commitRootPosition: () => {} },
    eventDispatcher: {
      dispatchMotionEvent: event => {
        main.handleMotionEvent(event);
        if (event.type === 'landed') recoveryAtMs = Date.now() +
          (event.outcome === 'crash_landing' ? LANDING_RECOVERY_MS.crash : LANDING_RECOVERY_MS.normal);
      },
      dispatchSurfaceEvent: event => { if (event.type === 'support_lost') main.handleSupportLost(); },
    },
    onVoluntaryMovementCompleted: completed => main.notifyVoluntaryMovementCompleted(completed),
  });
  main = new MainAutonomyComposition({
    clock: { now: Date.now },
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    prng: { next: () => random }, prngMetadata: { algorithm: 'constant', seed: 0 },
    getCharacterSnapshot: () => character.getSnapshot(),
    movement: {
      getRootPosition: () => motion.getMotionState().position, getBounds: () => bounds,
      getEnvironmentSnapshot: () => motion.getEnvironmentSnapshot(),
      getCollisionInsets: () => DEFAULT_MOTION_CONSTRAINTS.collisionInsets,
      canAcceptVoluntaryMovement: () => motion.canAcceptVoluntaryMovement(),
      requestVoluntaryMovement: command => motion.requestVoluntaryMovement(command),
      requestTraversal: request => motion.requestTraversal(request),
      cancelVoluntaryMovement: forDrag => motion.cancelVoluntaryMovement(forDrag),
    },
    requestManualRootPosition: () => false, createVisualEpisodeId: () => `visual-${++sequence}`,
    onPresentationChanged: () => {},
  });
  const advance = (ms: number) => {
    for (let i = 0; i < ms; i += 10) { vi.advanceTimersByTime(10); motion.tick(); main.tick(); }
  };
  try {
    motion.start(); main.start();
    const dragSessionId = motion.beginDrag({ pointerId: 1, sequence: 1, screenPosition: { x: 800, y: 1030 } })!;
    main.beginDrag(); advance(20);
    motion.moveDrag({ pointerId: 1, sequence: 2, dragSessionId, screenPosition: { x: 950, y: 900 } });
    advance(200);
    motion.releaseDrag({ pointerId: 1, sequence: 3, dragSessionId, screenPosition: { x: 950, y: 900 } });
    for (let i = 0; i < 500 && recoveryAtMs === undefined; i++) advance(10);
    expect(recoveryAtMs).toBeDefined();
    advance(recoveryAtMs! - Date.now());
    expect(main.getActivityTimeline(), JSON.stringify(main.getDecisionTrace())).not.toBeNull();
  } finally { main.dispose(); motion.stop(); }
});
