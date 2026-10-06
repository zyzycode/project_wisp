import { afterEach, expect, it, vi } from 'vitest';
import { MainAutonomyComposition } from '../../src/main/main-autonomy-composition';
import { ShimejiMotionOrchestrator } from '../../src/application/services/shimeji-motion-orchestrator';
import { MotionEngine } from '../../src/domain/behavior/motion-engine';
import { SurfaceKinematics, type ExternalWindowSurface } from '../../src/domain/behavior/surface-kinematics';
import { normalizeBridgeWindows } from '../../src/infrastructure/platform/window-surfaces-protocol';

afterEach(() => vi.useRealTimers());

it.each([
  { x: 167, y: 246, width: 1561, height: 815 },
  { x: 207, y: 425, width: 1561, height: 756 },
  { x: 486, y: 512, width: 1282, height: 721 },
])('runs native-geometry normalization → release → normal autonomy for %j', frame => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const bounds = { id: 'screen', x: 0, y: 0, width: 1920, height: 1032 };
  const tops: readonly ExternalWindowSurface[] = normalizeBridgeWindows([{ token: 'a'.repeat(32), ...frame, top: true, left: false, right: false }], [{
    physicalBounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: bounds,
  }], value => value, 'test');
  const top = tops[0];
  if (top?.kind !== 'window_top') throw new Error('Valid top was discarded');
  const dropX = frame.x + 143;
  let main: MainAutonomyComposition, revision = 0, sequence = 0;
  const events: string[] = [];
  const motion = new ShimejiMotionOrchestrator({
    initialMotion: { phase: 'grounded', position: { x: dropX, y: 1022 }, velocityPxPerSec: { x: 0, y: 0 }, activeBoundsId: 'screen', airborneElapsedSec: 0, peakGroundImpactSeverity: 0 },
    initialSurface: { phase: 'grounded', updatedAtMs: 0, locomotionVelocityPxPerSec: { x: 0, y: 0 } },
    motionEngine: new MotionEngine(), surfaceKinematics: new SurfaceKinematics(), now: Date.now,
    environment: () => ({ capturedAtMs: Date.now(), screenBounds: bounds, currentSurface: { id: 'floor', kind: 'screen_floor', bounds, isValidSupport: true } }),
    positionPort: { commitRootPosition: () => {} },
    externalWindows: { getSnapshot: () => ({ capability: 'available', capturedAtMs: Date.now(), revision: ++revision, surfaces: [top] }), subscribe: () => () => {}, dispose: () => {} },
    eventDispatcher: {
      dispatchMotionEvent: event => { events.push(event.type); main.handleMotionEvent(event); },
      dispatchSurfaceEvent: event => {
        events.push(event.type);
        if (event.type === 'support_lost') main.handleSupportLost();
        if (event.type === 'ceiling_hung') main.handleWindowSupportAttached();
      },
    },
    onVoluntaryMovementCompleted: done => main.notifyVoluntaryMovementCompleted(done),
  });
  main = new MainAutonomyComposition({
    clock: { now: Date.now },
    scheduler: { setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    prng: { next: () => 0 }, prngMetadata: { algorithm: 'test', seed: 1 },
    getCharacterSnapshot: () => ({ needs: { energy: 70, attention: 20, play: 30, comfort: 20, boredom: 40 }, relationship: { friendship: 0 }, synthesizedTone: 'neutral' }),
    movement: {
      getRootPosition: () => motion.getMotionState().position, getBounds: () => bounds,
      getEnvironmentSnapshot: () => motion.getEnvironmentSnapshot(),
      getCollisionInsets: () => ({ left: 50, right: 50, top: 90, bottom: 10 }),
      canAcceptVoluntaryMovement: () => motion.canAcceptVoluntaryMovement(),
      requestVoluntaryMovement: command => motion.requestVoluntaryMovement(command),
      cancelVoluntaryMovement: drag => motion.cancelVoluntaryMovement(drag),
    },
    requestManualRootPosition: () => false,
    createVisualEpisodeId: () => `visual-${++sequence}`, createActivityRunId: () => `activity-${++sequence}`,
    onPresentationChanged: () => {},
  });
  const advance = (ms: number) => { for (let i = 0; i < ms; i += 10) { vi.advanceTimersByTime(10); motion.tick(); main.tick(); } };
  try {
    motion.start(); main.start(); main.beginDrag();
    const dragSessionId = motion.beginDrag({ pointerId: 1, sequence: 0, screenPosition: { x: dropX, y: 1022 } })!;
    advance(10);
    motion.moveDrag({ pointerId: 1, sequence: 1, dragSessionId, screenPosition: { x: dropX, y: frame.y - 76 } });
    advance(200);
    motion.releaseDrag({ pointerId: 1, sequence: 2, dragSessionId, screenPosition: { x: dropX, y: frame.y - 76 } });
    advance(2000);
    expect(motion.getSurfaceState().externalAttachment?.surface.id).toBe(top.id);
    expect(motion.getMotionState().position).toEqual({ x: dropX, y: frame.y });
    expect(events.filter(e => e === 'landed')).toHaveLength(1);
    expect(events.filter(e => e === 'ceiling_hung')).toHaveLength(1);
    expect(events).not.toContain('support_lost');
  } finally { main.dispose(); motion.stop(); }
});
