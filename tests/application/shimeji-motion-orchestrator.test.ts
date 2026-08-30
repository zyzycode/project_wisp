import { describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import {
  DEFAULT_MOTION_CONSTRAINTS,
  MotionEngine,
  SurfaceKinematics,
  type MotionState,
  type SurfaceKinematicsState,
} from '../../src/domain/behavior';
import {
  ShimejiMotionOrchestrator,
  type IShimejiStimulusMapper,
  type ShimejiFeedbackEvent,
} from '../../src/application/services/shimeji-motion-orchestrator';

const environment = {
  capturedAtMs: 0,
  screenBounds: { id: 'primary', x: 0, y: 0, width: 1000, height: 800 },
};

function motion(overrides: Partial<MotionState> = {}): MotionState {
  return {
    phase: 'grounded',
    position: { x: 100, y: 790 },
    velocityPxPerSec: { x: 0, y: 0 },
    activeBoundsId: 'primary',
    airborneElapsedSec: 0,
    peakGroundImpactSeverity: 0,
    ...overrides,
  };
}

const initialSurface: SurfaceKinematicsState = {
  phase: 'grounded',
  updatedAtMs: 0,
  locomotionVelocityPxPerSec: { x: 0, y: 0 },
};

function createOrchestrator(now: () => number, initialMotion: MotionState = motion()) {
  const commitRootPosition = vi.fn();
  const dispatchMotionEvent = vi.fn();
  const dispatchSurfaceEvent = vi.fn();
  const applyStimulus = vi.fn();
  const mapper: IShimejiStimulusMapper = {
    map: (event: ShimejiFeedbackEvent) => ({ id: `stimulus:${event.eventId}`, type: 'user_drag_start' }),
  };
  const orchestrator = new ShimejiMotionOrchestrator({
    initialMotion,
    initialSurface,
    motionEngine: new MotionEngine(),
    surfaceKinematics: new SurfaceKinematics(),
    environment: () => environment,
    positionPort: { commitRootPosition },
    now,
    eventDispatcher: { dispatchMotionEvent, dispatchSurfaceEvent },
    stimulusMapper: mapper,
    applyStimulus,
    createDragSessionId: () => 'session-1',
  });
  return { orchestrator, commitRootPosition, dispatchMotionEvent, dispatchSurfaceEvent, applyStimulus };
}

describe('Application: ShimejiMotionOrchestrator', () => {
  it('accepts the Main monotonic-clock wrapper without a receiver binding error', () => {
    const commitRootPosition = vi.fn();
    const orchestrator = new ShimejiMotionOrchestrator({
      initialMotion: motion(), initialSurface, motionEngine: new MotionEngine(), surfaceKinematics: new SurfaceKinematics(),
      environment: () => environment, positionPort: { commitRootPosition }, now: () => performance.now(),
    });

    expect(() => {
      orchestrator.start();
      orchestrator.tick();
      orchestrator.stop();
    }).not.toThrow();
  });

  it('commits a presentation transition when drag starts without a root-position change', () => {
    let nowMs = 0;
    const result = createOrchestrator(() => nowMs);
    result.orchestrator.start();
    result.orchestrator.beginDrag({ pointerId: 1, sequence: 0, screenPosition: { x: 100, y: 790 } });

    nowMs = 10;
    expect(result.orchestrator.tick()).toBe(true);

    expect(result.orchestrator.getMotionState().phase).toBe('dragged');
    expect(result.commitRootPosition).not.toHaveBeenCalled();
    expect(result.orchestrator.getPresentationRevision()).toBe(1);
  });

  it('consumes queued pointer input in sequence order, routes events, and commits once per tick', () => {
    let nowMs = 0;
    const result = createOrchestrator(() => nowMs);
    result.orchestrator.start();

    const sessionId = result.orchestrator.beginDrag({
      pointerId: 7,
      sequence: 0,
      screenPosition: { x: 100, y: 790 },
    });
    expect(sessionId).toBe('session-1');
    result.orchestrator.moveDrag({
      pointerId: 7,
      dragSessionId: 'session-1',
      sequence: 1,
      screenPosition: { x: 160, y: 720 },
    });
    result.orchestrator.moveDrag({
      pointerId: 7,
      dragSessionId: 'session-1',
      sequence: 1,
      screenPosition: { x: 999, y: 1 },
    });

    nowMs = 10;
    result.orchestrator.tick();

    expect(result.orchestrator.getMotionState()).toMatchObject({
      phase: 'dragged',
      position: { x: 160, y: 720 },
    });
    expect(result.commitRootPosition).toHaveBeenCalledTimes(1);
    expect(result.commitRootPosition).toHaveBeenCalledWith({
      rootPosition: { x: 160, y: 720 },
      bounds: environment.screenBounds,
    });
    expect(result.dispatchMotionEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'drag_started' }));
    expect(result.dispatchSurfaceEvent).not.toHaveBeenCalled();
    expect(result.applyStimulus).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'stimulus:session-1:started', type: 'user_drag_start' })
    );
    expect(result.orchestrator.getPresentationRevision()).toBe(1);
  });

  it('syncs root position when not dragged or airborne', () => {
    let nowMs = 0;
    const result = createOrchestrator(() => nowMs, motion({ position: { x: 100, y: 790 } }));
    result.orchestrator.start();

    result.orchestrator.syncRootPosition({ x: 350, y: 500 });
    expect(result.orchestrator.getMotionState().position).toEqual({ x: 350, y: 500 });

    // beginDrag should now calculate grabOffset based on the synced position
    result.orchestrator.beginDrag({ pointerId: 1, sequence: 0, screenPosition: { x: 350, y: 500 } });
    result.orchestrator.syncRootPosition({ x: 999, y: 999 }); // should NOT overwrite while dragged
    expect(result.orchestrator.getMotionState().position).toEqual({ x: 350, y: 500 });
  });

  it('clamps frame delta and preserves a fixed-step remainder', () => {
    let nowMs = 0;
    const result = createOrchestrator(
      () => nowMs,
      motion({ phase: 'airborne', position: { x: 500, y: 300 }, velocityPxPerSec: { x: 0, y: 0 } })
    );
    result.orchestrator.start();

    nowMs = 1000;
    result.orchestrator.tick();

    expect(result.orchestrator.getMotionState().airborneElapsedSec).toBeCloseTo(
      DEFAULT_MOTION_CONSTRAINTS.maxFrameDeltaSec,
      8
    );
    expect(result.commitRootPosition).toHaveBeenCalledTimes(1);
  });

  it('uses simulated fixed-step time for attached-surface catch-up', () => {
    let nowMs = 0;
    const climbEnvironment = {
      ...environment,
      currentSurface: {
        id: 'screen-floor', kind: 'screen_floor' as const,
        bounds: { x: 0, y: 0, width: 1000, height: 800 }, supportY: 790, isValidSupport: true,
      },
    };
    const orchestrator = new ShimejiMotionOrchestrator({
      initialMotion: motion({ position: { x: 0, y: 400 } }),
      initialSurface: {
        phase: 'climbing_wall', updatedAtMs: 0, surfaceId: 'screen-floor', wallSide: 'left',
        locomotionVelocityPxPerSec: { x: 0, y: -120 },
      },
      motionEngine: new MotionEngine(), surfaceKinematics: new SurfaceKinematics(), environment: () => climbEnvironment,
      positionPort: { commitRootPosition: vi.fn() }, now: () => nowMs,
    });
    orchestrator.start();

    nowMs = 1000;
    orchestrator.tick();

    expect(orchestrator.getMotionState().position).toEqual({ x: 0, y: 370 });
  });

  it('preserves Main receive times for throw samples queued before one tick', () => {
    let nowMs = 0;
    const result = createOrchestrator(() => nowMs, motion({ position: { x: 100, y: 400 } }));
    result.orchestrator.start();
    result.orchestrator.beginDrag({ pointerId: 5, sequence: 0, screenPosition: { x: 100, y: 400 } });
    nowMs = 40;
    result.orchestrator.moveDrag({
      pointerId: 5, dragSessionId: 'session-1', sequence: 1, screenPosition: { x: 140, y: 400 },
    });
    nowMs = 80;
    result.orchestrator.releaseDrag({
      pointerId: 5, dragSessionId: 'session-1', sequence: 2, screenPosition: { x: 180, y: 400 },
    });

    nowMs = 100;
    result.orchestrator.tick();

    expect(result.orchestrator.getMotionState()).toMatchObject({ phase: 'airborne' });
    expect(result.orchestrator.getMotionState().velocityPxPerSec.x).toBeGreaterThan(500);
  });

  it('rejects foreign, invalid, duplicate, and out-of-order pointer messages', () => {
    let nowMs = 0;
    const result = createOrchestrator(() => nowMs);
    result.orchestrator.start();
    result.orchestrator.beginDrag({ pointerId: 3, sequence: 0, screenPosition: { x: 100, y: 790 } });

    result.orchestrator.moveDrag({
      pointerId: 4,
      dragSessionId: 'session-1',
      sequence: 1,
      screenPosition: { x: 600, y: 1 },
    });
    result.orchestrator.moveDrag({
      pointerId: 3,
      dragSessionId: 'foreign',
      sequence: 1,
      screenPosition: { x: 600, y: 1 },
    });
    result.orchestrator.moveDrag({
      pointerId: 3,
      dragSessionId: 'session-1',
      sequence: 1,
      screenPosition: { x: Number.NaN, y: 1 },
    });
    result.orchestrator.moveDrag({
      pointerId: 3,
      dragSessionId: 'session-1',
      sequence: 2,
      screenPosition: { x: 180, y: 740 },
    });
    result.orchestrator.moveDrag({
      pointerId: 3,
      dragSessionId: 'session-1',
      sequence: 1,
      screenPosition: { x: 500, y: 1 },
    });

    nowMs = 10;
    result.orchestrator.tick();

    expect(result.orchestrator.getMotionState().position).toEqual({ x: 180, y: 740 });
  });

  it('cancels scheduled work when stopped', () => {
    let nowMs = 0;
    let scheduled: (() => void) | undefined;
    const cancel = vi.fn();
    const result = createOrchestrator(() => nowMs);
    const orchestrator = new ShimejiMotionOrchestrator({
      initialMotion: motion(), initialSurface, motionEngine: new MotionEngine(), surfaceKinematics: new SurfaceKinematics(),
      environment: () => environment, positionPort: { commitRootPosition: result.commitRootPosition }, now: () => nowMs,
      scheduler: { schedule: (callback) => { scheduled = callback; return cancel; } },
    });
    orchestrator.start();
    orchestrator.stop();
    scheduled?.();

    expect(cancel).toHaveBeenCalledOnce();
    expect(result.commitRootPosition).not.toHaveBeenCalled();
  });
});
