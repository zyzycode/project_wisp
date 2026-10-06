import { describe, expect, it, vi } from 'vitest';
import { ShimejiMotionOrchestrator } from '../../src/application/services/shimeji-motion-orchestrator';
import { MotionEngine, type MotionEvent } from '../../src/domain/behavior/motion-engine';
import { SurfaceKinematics, type EnvironmentSnapshot } from '../../src/domain/behavior/surface-kinematics';
import type { TraversalAction } from '../../src/domain/behavior/traversal-route';

const bounds = { id: 'screen', x: 0, y: 0, width: 1000, height: 800 };
function fixture(x = 50, y = 790) {
  let now = 0;
  let environment: EnvironmentSnapshot = { capturedAtMs: 0, screenBounds: bounds,
    currentSurface: { id: 'floor', kind: 'screen_floor', bounds, isValidSupport: true } };
  const events: MotionEvent[] = [];
  const complete = vi.fn();
  const rejected = vi.fn();
  const commit = vi.fn();
  const orchestrator = new ShimejiMotionOrchestrator({
    initialMotion: { phase: 'grounded', position: { x, y }, velocityPxPerSec: { x: 0, y: 0 },
      activeBoundsId: bounds.id, airborneElapsedSec: 0, peakGroundImpactSeverity: 0 },
    initialSurface: { phase: 'grounded', locomotionVelocityPxPerSec: { x: 0, y: 0 }, updatedAtMs: 0 },
    motionEngine: new MotionEngine(), surfaceKinematics: new SurfaceKinematics(), now: () => now,
    environment: () => environment, positionPort: { commitRootPosition: commit },
    onVoluntaryMovementCompleted: complete, onTraversalRejected: rejected,
    eventDispatcher: { dispatchMotionEvent: e => events.push(e), dispatchSurfaceEvent: () => {} },
  });
  orchestrator.start();
  return { orchestrator, events, complete, rejected, commit,
    request: (action: TraversalAction, stepId = 'step') => orchestrator.requestTraversal({ runId: 'run', stepId, action }),
    advance: (ms: number) => { for (let i = 0; i < ms / 10; i++) { now += 10; orchestrator.tick(); } },
    invalidate: () => { environment = { ...environment, currentSurface: { ...environment.currentSurface!, isValidSupport: false } }; },
    resize: () => { environment = { ...environment, screenBounds: { ...bounds, width: 900 } }; },
  };
}
const up: TraversalAction = { kind: 'screen_climb', side: 'left', direction: 'up', bounds, supportId: 'floor' };
const jump: TraversalAction = { kind: 'directed_jump', target: { x: 450, y: 790 }, bounds, supportId: 'floor' };

describe('AUTO-I04 Application traversal', () => {
  it('rejects invalidated pending work on the floor without inventing an airborne lifecycle', () => {
    const f = fixture();
    f.request(up);
    f.invalidate(); f.advance(10);
    expect(f.rejected).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ runId: 'run', stepId: 'step' }));
    expect(f.orchestrator.getMotionState().phase).toBe('grounded');
    expect(f.events).toEqual([]);
    expect(f.complete).not.toHaveBeenCalled();
  });
  it('finishes a downward Activity step on the floor without a rebound', () => {
    const f = fixture(50, 300);
    expect(f.request({ ...up, direction: 'down' })).toBe(true);
    f.advance(2400);
    expect(f.orchestrator.getMotionState()).toMatchObject({ phase: 'grounded', position: { x: 50, y: 790 } });
    expect(f.orchestrator.getSurfaceState().phase).toBe('grounded');
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect(f.events.some(e => e.type === 'airborne_started')).toBe(false);
  });

  it('rejects a distant grab and non-floor jump targets before any position commit', () => {
    const f = fixture(400);
    expect(f.request(up)).toBe(false);
    expect(f.request({ ...jump, target: { x: 450, y: 500 } })).toBe(false);
    expect(f.commit).not.toHaveBeenCalled();
  });
  it('climbs to top, waits attached for the next Activity step, then lands its rebound once', () => {
    const f = fixture();
    expect(f.request(up, 'climb')).toBe(true);
    f.advance(3500);
    expect(f.orchestrator.getMotionState().position).toEqual({ x: 50, y: 90 });
    expect(f.complete).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ runId: 'run', stepId: 'climb' }));
    expect(f.orchestrator.requestTraversal({ runId: 'foreign', stepId: 'jump', action: jump })).toBe(false);
    expect(f.request(jump, 'rebound')).toBe(true);
    f.advance(1200);
    expect(f.orchestrator.getMotionState()).toMatchObject({ phase: 'grounded', position: jump.target });
    expect(f.orchestrator.getSurfaceState().phase).toBe('grounded');
    expect(f.complete).toHaveBeenCalledTimes(2);
    expect(f.events.filter(e => e.type === 'landed')).toHaveLength(1);
    expect(f.events.filter(e => e.type === 'airborne_started')).toEqual([expect.objectContaining({ cause: 'voluntary_jump' })]);
  });
  it.each(['invalidate', 'resize', 'cancel'] as const)('%s detaches once and falls without route completion or reattachment', (reason) => {
    const f = fixture();
    f.request(up);
    f.advance(1000);
    const y = f.orchestrator.getMotionState().position.y;
    if (reason === 'cancel') f.orchestrator.cancelVoluntaryMovement(); else f[reason]();
    f.advance(10);
    expect(f.orchestrator.getMotionState().phase).toBe('airborne');
    expect(f.orchestrator.getMotionState().position.y).toBeLessThan(y + 5);
    f.advance(4000);
    expect(f.events.filter(e => e.type === 'airborne_started' && e.cause === 'support_lost')).toHaveLength(1);
    expect(f.orchestrator.getMotionState().phase).toBe('grounded');
    expect(f.complete).not.toHaveBeenCalled();
  });
  it('cancels a directed arc into ordinary fall, preserving velocity and clearing its target', () => {
    const f = fixture(200);
    f.request(jump);
    f.advance(100);
    const before = f.orchestrator.getMotionState();
    f.orchestrator.cancelVoluntaryMovement();
    expect(f.orchestrator.getMotionState()).toMatchObject({ position: before.position, velocityPxPerSec: before.velocityPxPerSec });
    expect(f.orchestrator.getMotionState().directedJump).toBeUndefined();
    f.advance(3000);
    expect(f.orchestrator.getMotionState().phase).toBe('grounded');
    expect(f.complete).not.toHaveBeenCalled();
  });
  it('drag wins over an attachment without support_lost and shutdown prevents late commits', () => {
    const f = fixture();
    f.request(up); f.advance(100);
    f.orchestrator.beginDrag({ pointerId: 1, sequence: 0, screenPosition: f.orchestrator.getMotionState().position });
    f.advance(10);
    expect(f.orchestrator.getMotionState().phase).toBe('dragged');
    expect(f.events.some(e => e.type === 'airborne_started')).toBe(false);
    f.orchestrator.stop();
    const calls = f.commit.mock.calls.length;
    f.advance(1000);
    expect(f.commit).toHaveBeenCalledTimes(calls);
    expect(f.complete).not.toHaveBeenCalled();
  });
});
