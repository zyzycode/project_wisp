import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOTION_CONSTRAINTS,
  MotionEngine,
  SurfaceKinematics,
  type EnvironmentSnapshot,
  type MotionState,
} from '../../src/domain/behavior';

const environment: EnvironmentSnapshot = {
  capturedAtMs: 0,
  screenBounds: { id: 'primary', x: 0, y: 0, width: 1000, height: 800 },
  currentSurface: {
    id: 'screen-floor',
    kind: 'screen_floor',
    bounds: { x: 0, y: 0, width: 1000, height: 800 },
    supportY: 790,
    isValidSupport: true,
  },
};

function motion(overrides: Partial<MotionState> = {}): MotionState {
  return {
    phase: 'grounded',
    position: { x: 400, y: 400 },
    velocityPxPerSec: { x: 0, y: 0 },
    activeBoundsId: environment.screenBounds.id,
    airborneElapsedSec: 0,
    peakGroundImpactSeverity: 0,
    ...overrides,
  };
}

describe('Domain: SurfaceKinematics', () => {
  it('climbs along a screen wall with an explicit monotonic elapsed time', () => {
    const surface = new SurfaceKinematics();
    const started = surface.startWallClimb({
      motion: motion(),
      environment,
      side: 'left',
      verticalSpeedPxPerSec: -120,
      nowMs: 100,
    });

    expect(started).not.toBeNull();
    if (started === null) throw new Error('wall climb was not started');
    expect(started.motion.state.position).toEqual({ x: 0, y: 400 });

    const stepped = surface.step(
      { state: started.state, motion: started.motion.state, environment, nowMs: 600 },
      new MotionEngine()
    );
    expect(stepped.state.phase).toBe('climbing_wall');
    expect(stepped.motion.state.position).toEqual({ x: 0, y: 340 });
    expect(stepped.motion.state.velocityPxPerSec).toEqual({ x: 0, y: -120 });
  });

  it('hangs from a window top and crawls horizontally until the support moves out from under it', () => {
    const surface = new SurfaceKinematics();
    const ceilingEnvironment: EnvironmentSnapshot = {
      ...environment,
      currentSurface: {
        id: 'window-top',
        kind: 'window_top',
        bounds: { x: 300, y: 250, width: 200, height: 20 },
        supportY: 250,
        isValidSupport: true,
      },
    };
    const started = surface.startCeilingHang({
      motion: motion({ position: { x: 490, y: 500 } }),
      environment: ceilingEnvironment,
      crawlSpeedPxPerSec: 40,
      nowMs: 0,
    });

    expect(started).not.toBeNull();
    if (started === null) throw new Error('ceiling hang was not started');
    expect(started.motion.state.position).toEqual({ x: 490, y: 250 });

    const lost = surface.step(
      { state: started.state, motion: started.motion.state, environment: ceilingEnvironment, nowMs: 500 },
      new MotionEngine()
    );
    expect(lost.state.phase).toBe('airborne');
    expect(lost.motion.state.position).toEqual({ x: 510, y: 250 });
    expect(lost.motion.events).toContainEqual(
      expect.objectContaining({ type: 'airborne_started', cause: 'support_lost', atMs: 500 })
    );
    expect(lost.events).toContainEqual(
      expect.objectContaining({ type: 'support_lost', surfaceId: 'window-top', atMs: 500 })
    );
  });

  it('starts support_lost airborne motion when an attached surface becomes invalid and falls to floor', () => {
    const surface = new SurfaceKinematics();
    const engine = new MotionEngine();
    const started = surface.startWallClimb({
      motion: motion({ position: { x: 0, y: 700 } }),
      environment,
      side: 'left',
      verticalSpeedPxPerSec: 0,
      nowMs: 0,
    });

    expect(started).not.toBeNull();
    if (started === null) throw new Error('wall climb was not started');
    const currentSurface = environment.currentSurface;
    if (currentSurface === undefined) throw new Error('test environment has no surface');
    const invalidEnvironment: EnvironmentSnapshot = {
      ...environment,
      currentSurface: { ...currentSurface, isValidSupport: false },
    };
    let result = surface.step(
      { state: started.state, motion: started.motion.state, environment: invalidEnvironment, nowMs: 100 },
      engine
    );

    expect(result.state.phase).toBe('airborne');
    expect(result.motion.state.phase).toBe('airborne');
    expect(result.motion.events).toContainEqual(
      expect.objectContaining({ type: 'airborne_started', cause: 'support_lost', atMs: 100 })
    );

    for (let index = 0; index < 500; index += 1) {
      result = {
        ...result,
        motion: engine.step({
          state: result.motion.state,
          stepSec: DEFAULT_MOTION_CONSTRAINTS.fixedStepSec,
          bounds: environment.screenBounds,
        }),
      };
      if (result.motion.state.phase === 'grounded') break;
    }

    expect(result.motion.state.phase).toBe('grounded');
    expect(result.motion.state.position.y).toBe(790);
  });

  it('rejects a clock that goes backwards and unsupported attachment starts', () => {
    const surface = new SurfaceKinematics();
    expect(
      surface.startCeilingHang({
        motion: motion(),
        environment,
        crawlSpeedPxPerSec: 30,
        nowMs: 0,
      })
    ).toBeNull();

    expect(() =>
      surface.step(
        {
          state: {
            phase: 'grounded',
            updatedAtMs: 10,
            locomotionVelocityPxPerSec: { x: 0, y: 0 },
          },
          motion: motion(),
          environment,
          nowMs: 9,
        },
        new MotionEngine()
      )
    ).toThrow(RangeError);
  });
});
