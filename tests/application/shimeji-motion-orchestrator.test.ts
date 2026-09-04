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
import { PetPositionService } from '../../src/application/services/pet-position.service';
import { ElectronPetPositionAdapter } from '../../src/infrastructure/adapters/electron-pet-position-adapter';
import type { BrowserWindow } from 'electron';

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

  it('queues manual root movement and applies it only on a fixed-step boundary', () => {
    let nowMs = 0;
    const result = createOrchestrator(() => nowMs, motion({ position: { x: 100, y: 790 } }));
    result.orchestrator.start();

    expect(result.orchestrator.requestVoluntaryMovement({
      kind: 'manual_root',
      targetRootPosition: { x: 350, y: 500 },
    })).toBe(true);
    expect(result.orchestrator.getMotionState().position).toEqual({ x: 100, y: 790 });
    nowMs = 10;
    result.orchestrator.tick();
    expect(result.orchestrator.getMotionState().position).toEqual({ x: 350, y: 500 });

    result.orchestrator.beginDrag({ pointerId: 1, sequence: 0, screenPosition: { x: 350, y: 500 } });
    expect(result.orchestrator.requestVoluntaryMovement({
      kind: 'manual_root',
      targetRootPosition: { x: 999, y: 799 },
    })).toBe(false);
  });

  it('commits the final root before reporting voluntary movement completion', () => {
    let nowMs = 0;
    const order: string[] = [];
    const commitRootPosition = vi.fn(() => order.push('commit'));
    const onVoluntaryMovementCompleted = vi.fn(() => order.push('completed'));
    const orchestrator = new ShimejiMotionOrchestrator({
      initialMotion: motion({ position: { x: 100, y: 500 } }),
      initialSurface,
      motionEngine: new MotionEngine(),
      surfaceKinematics: new SurfaceKinematics(),
      environment: () => environment,
      positionPort: { commitRootPosition },
      now: () => nowMs,
      onVoluntaryMovementCompleted,
    });
    orchestrator.start();
    expect(orchestrator.requestVoluntaryMovement({
      kind: 'manual_root',
      targetRootPosition: { x: 350, y: 500 },
    })).toBe(true);

    nowMs = 10;
    const presentationChanged = orchestrator.tick();
    if (presentationChanged) order.push('presentation');

    expect(order).toEqual(['commit', 'completed', 'presentation']);
    expect(commitRootPosition).toHaveBeenCalledOnce();
    expect(onVoluntaryMovementCompleted).toHaveBeenCalledOnce();
  });

  it('validates voluntary commands and moves by at most speed times fixed-step', () => {
    let nowMs = 0;
    const result = createOrchestrator(() => nowMs, motion({ position: { x: 100, y: 500 } }));
    result.orchestrator.start();

    expect(result.orchestrator.requestVoluntaryMovement({
      kind: 'horizontal_wander',
      targetRootPosition: { x: 140, y: 500 },
      speedPxPerSec: 90,
    })).toBe(true);
    expect(result.commitRootPosition).not.toHaveBeenCalled();
    nowMs = 10;
    result.orchestrator.tick();
    expect(result.orchestrator.getMotionState().position.x).toBeCloseTo(100.75, 8);
    expect(result.commitRootPosition).toHaveBeenCalledTimes(1);
    expect(result.orchestrator.getPresentationRevision()).toBe(1);

    result.orchestrator.beginDrag({ pointerId: 1, sequence: 0, screenPosition: { x: 140, y: 500 } });
    expect(result.orchestrator.requestVoluntaryMovement({
      kind: 'horizontal_wander',
      targetRootPosition: { x: 200, y: 500 },
      speedPxPerSec: 90,
    })).toBe(false);
    expect(result.orchestrator.requestVoluntaryMovement({
      kind: 'horizontal_wander',
      targetRootPosition: { x: Number.NaN, y: 500 },
      speedPxPerSec: 90,
    })).toBe(false);
  });

  it('reclamps an active root target after bounds change and commits once for catch-up substeps', () => {
    let nowMs = 0;
    let currentEnvironment = environment;
    const commitRootPosition = vi.fn();
    const orchestrator = new ShimejiMotionOrchestrator({
      initialMotion: motion({ position: { x: 900, y: 790 } }),
      initialSurface,
      motionEngine: new MotionEngine(),
      surfaceKinematics: new SurfaceKinematics(),
      environment: () => currentEnvironment,
      positionPort: { commitRootPosition },
      now: () => nowMs,
    });
    orchestrator.start();
    expect(orchestrator.requestVoluntaryMovement({
      kind: 'horizontal_wander',
      targetRootPosition: { x: 950, y: 790 }, speedPxPerSec: 120,
    })).toBe(true);
    currentEnvironment = {
      ...environment,
      screenBounds: { ...environment.screenBounds, width: 300 },
    };
    nowMs = 100;
    orchestrator.tick();

    expect(orchestrator.getMotionState().position.x).toBe(250);
    expect(commitRootPosition).toHaveBeenCalledTimes(1);
  });

  it('cancels an active voluntary command before drag can mutate the fixed step', () => {
    let nowMs = 0;
    const result = createOrchestrator(() => nowMs, motion({ position: { x: 100, y: 500 } }));
    result.orchestrator.start();
    expect(result.orchestrator.requestVoluntaryMovement({
      kind: 'horizontal_wander',
      targetRootPosition: { x: 900, y: 500 }, speedPxPerSec: 100,
    })).toBe(true);
    result.orchestrator.beginDrag({ pointerId: 1, sequence: 0, screenPosition: { x: 100, y: 500 } });
    nowMs = 10;
    result.orchestrator.tick();

    expect(result.orchestrator.getMotionState()).toMatchObject({
      phase: 'dragged',
      position: { x: 100, y: 500 },
    });
  });

  it('keeps the stored root, Motion root, and adapter conversion equal after commit', () => {
    let nowMs = 0;
    const setPosition = vi.fn();
    const window = { isDestroyed: () => false, setPosition } as unknown as BrowserWindow;
    const positionService = new PetPositionService({ x: 100, y: 500 });
    const orchestrator = new ShimejiMotionOrchestrator({
      initialMotion: motion({ position: { x: 100, y: 500 } }),
      initialSurface,
      motionEngine: new MotionEngine(),
      surfaceKinematics: new SurfaceKinematics(),
      environment: () => environment,
      positionService,
      positionPort: new ElectronPetPositionAdapter({
        getWindow: () => window,
        pivotOffset: { x: 50, y: 90 },
      }),
      now: () => nowMs,
    });
    orchestrator.start();
    orchestrator.requestVoluntaryMovement({
      kind: 'horizontal_wander',
      targetRootPosition: { x: 140, y: 500 }, speedPxPerSec: 100_000,
    });
    nowMs = 10;
    orchestrator.tick();

    expect(positionService.getRootPosition()).toEqual(orchestrator.getMotionState().position);
    expect(setPosition).toHaveBeenCalledWith(90, 410);
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
