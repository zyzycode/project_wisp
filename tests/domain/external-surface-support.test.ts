import { describe, expect, it } from 'vitest';
import { DEFAULT_MOTION_CONSTRAINTS, MotionEngine, type MotionState } from '../../src/domain/behavior/motion-engine';
import { SurfaceKinematics, type EnvironmentSnapshot, type ExternalWindowSurface } from '../../src/domain/behavior/surface-kinematics';
import { createWindowPerchActivity, selectWindowTopForRelease } from '../../src/domain/behavior/external-surface-support';
const bounds = { id: 'display', x: 0, y: 0, width: 1000, height: 800 };
const top: ExternalWindowSurface = { id: 'opaque:top', kind: 'window_top', bounds: { x: 300, y: 250, width: 200, height: 200 }, supportY: 250, isValidSupport: true };
const environment: EnvironmentSnapshot = { capturedAtMs: 0, screenBounds: bounds, currentSurface: top };
const motion: MotionState = { phase: 'grounded', position: { x: 420, y: 250 }, velocityPxPerSec: { x: 0, y: 0 }, activeBoundsId: bounds.id, airborneElapsedSec: 0, peakGroundImpactSeverity: 0 };
const insets = DEFAULT_MOTION_CONSTRAINTS.collisionInsets;
const engine = new MotionEngine();
const surfaces = new SurfaceKinematics();
function start(surface = top, position = motion.position) {
  return surfaces.startExternalSupport({ motion: { ...motion, position }, environment: { ...environment, currentSurface: surface },
    nowMs: 0, observationNowMs: 0, collisionInsets: insets })!;
}
function moved(x: number, y: number, width = 200): EnvironmentSnapshot {
  return { ...environment, currentSurface: { ...top, bounds: { ...top.bounds, x, y, width }, supportY: y } };
}

describe('AUTO-I05 external support lifecycle', () => {
  it('follows a translated top once, preserves local DIP distance on resize and never adds window velocity', () => {
    const initial = start();
    const first = surfaces.step({ state: initial.state, motion: initial.motion.state, environment: moved(350, 300, 250), nowMs: 100 }, engine);
    expect(first.motion.state.position).toEqual({ x: 470, y: 300 });
    const repeated = surfaces.step({ state: first.state, motion: first.motion.state, environment: moved(350, 300, 300), nowMs: 110 }, engine);
    expect(repeated.motion.state.position).toEqual({ x: 470, y: 300 });
    expect(repeated.motion.state.velocityPxPerSec).toEqual({ x: 0, y: 0 });
    expect(repeated.state.externalAttachment?.localDistancePx).toBe(120);
  });
  it('loses resized support at the last accepted root instead of clamping or teleporting', () => {
    const initial = start();
    const state = { ...initial.state, locomotionVelocityPxPerSec: { x: 40, y: 0 } };
    const lost = surfaces.step({ state, motion: initial.motion.state, environment: moved(500, 100, 100), nowMs: 100 }, engine);
    expect(lost.motion.state).toMatchObject({ phase: 'airborne', position: motion.position, velocityPxPerSec: { x: 40, y: 0 } });
    expect(lost.events).toHaveLength(1);
    const recovered = surfaces.step({ state: lost.state, motion: lost.motion.state, environment, nowMs: 120 }, engine);
    expect(recovered.state.phase).toBe('airborne'); expect(recovered.events).toEqual([]);
  });
  it.each(['missing', 'stale', 'future', 'offscreen', 'identity'] as const)('%s detaches exactly once', reason => {
    const initial = start();
    let next: EnvironmentSnapshot = environment;
    if (reason === 'missing') next = { ...environment, currentSurface: undefined };
    if (reason === 'stale') next = { ...environment, capturedAtMs: -1000 };
    if (reason === 'future') next = { ...environment, capturedAtMs: 1000 };
    if (reason === 'offscreen') next = moved(-300, 250);
    if (reason === 'identity') next = { ...environment, currentSurface: { ...top, id: 'new' } };
    const result = surfaces.step({ state: initial.state, motion: initial.motion.state, environment: next, nowMs: 100 }, engine);
    expect(result.events).toEqual([{ type: 'support_lost', surfaceId: top.id, atMs: 100 }]);
    expect(result.motion.state.position).toEqual(motion.position);
  });
  it('recomputes a right side normal coordinate and retains its vertical local distance', () => {
    const side: ExternalWindowSurface = { id: 'side', kind: 'window_side', side: 'right', bounds: top.bounds, isValidSupport: true };
    const initial = start(side, { x: 500, y: 330 });
    const next = { ...environment, currentSurface: { ...side, bounds: { x: 350, y: 300, width: 300, height: 100 } } };
    const result = surfaces.step({ state: initial.state, motion: initial.motion.state, environment: next, nowMs: 100 }, engine);
    expect(result.motion.state.position).toEqual({ x: 650, y: 380 });
  });
  it('gives drag priority even when the attached support is gone', () => {
    const initial = start();
    const result = surfaces.step({ state: initial.state, motion: { ...initial.motion.state, phase: 'dragged' },
      environment: { ...environment, currentSurface: undefined }, nowMs: 20 }, engine);
    expect(result.events).toEqual([]); expect(result.state.externalAttachment).toBeUndefined();
  });
  it('selects only nearby top edges on release and constructs a user continuation with local coordinates', () => {
    expect(selectWindowTopForRelease([top], { x: 301, y: 258 }, () => environment, insets)?.id).toBe(top.id);
    expect(selectWindowTopForRelease([top], { x: 301, y: 270 }, () => environment, insets)).toBeNull();
    const activity = createWindowPerchActivity(top, { x: 301, y: 250 })!;
    expect(activity.steps.map(step => step.id)).toEqual(['land', 'walk_support', 'perch']);
    expect(activity.steps[1]).toMatchObject({ targetRef: top.id, supportLocalDistancePx: 48 });
    expect(activity.steps[2]).toMatchObject({ intent: { kind: 'sit_edge' } });
    expect(createWindowPerchActivity(top, motion.position)?.steps.map(step => step.id)).toEqual(['land', 'perch']);
  });
});
