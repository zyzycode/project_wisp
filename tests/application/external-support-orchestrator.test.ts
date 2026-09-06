import { describe, expect, it, vi } from 'vitest';
import { ShimejiMotionOrchestrator } from '../../src/application/services/shimeji-motion-orchestrator';
import { MotionEngine } from '../../src/domain/behavior/motion-engine';
import { SurfaceKinematics, type ExternalWindowSurface } from '../../src/domain/behavior/surface-kinematics';
import type { ExternalWindowSurfacesSnapshot } from '../../src/application/ports/external-window-surfaces.port';
import { normalizeBridgeWindows } from '../../src/infrastructure/platform/window-surfaces-protocol';
function fixture(explorer = false) {
  let now = 0; let revision = 0; let available = true;
  let surface: Extract<ExternalWindowSurface, { kind: 'window_top' }> = { id: 'opaque:top', kind: 'window_top', bounds: { x: 300, y: 250, width: 300, height: 300 }, supportY: 250, isValidSupport: true };
  const events: string[] = [];
  if (explorer) {
    const normalized = normalizeBridgeWindows([{ token: 'a'.repeat(32), x: 167, y: 246, width: 1561, height: 815,
      top: true, left: false, right: false }], [{ physicalBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1032 } }], bounds => bounds, 'epoch');
    const top = normalized.find(s => s.kind === 'window_top');
    if (top?.kind !== 'window_top') throw new Error('Explorer top discarded');
    surface = top;
  }
  const bounds = { id: 'screen', x: 0, y: 0, width: explorer ? 1920 : 1000, height: explorer ? 1032 : 800 };
  const o = new ShimejiMotionOrchestrator({
    initialMotion: { phase: 'grounded', position: { x: 310, y: 250 }, velocityPxPerSec: { x: 0, y: 0 }, activeBoundsId: 'screen', airborneElapsedSec: 0, peakGroundImpactSeverity: 0 },
    initialSurface: { phase: 'grounded', locomotionVelocityPxPerSec: { x: 0, y: 0 }, updatedAtMs: 0 },
    now: () => now, motionEngine: new MotionEngine(), surfaceKinematics: new SurfaceKinematics(),
    environment: () => ({ capturedAtMs: now, screenBounds: bounds, currentSurface: { id: 'floor', kind: 'screen_floor', bounds, isValidSupport: true } }),
    positionPort: { commitRootPosition: vi.fn() },
    externalWindows: { getSnapshot: (): ExternalWindowSurfacesSnapshot => available
      ? { capability: 'available', revision: ++revision, capturedAtMs: now, surfaces: [surface] }
      : { capability: 'unavailable', reason: 'bridge_failed', revision: ++revision, capturedAtMs: now, surfaces: [] }, subscribe: () => () => {}, dispose: () => {} },
    eventDispatcher: { dispatchMotionEvent: e => events.push(e.type), dispatchSurfaceEvent: e => events.push(e.type) },
  });
  o.start();
  const advance = (ms: number) => { for (let i = 0; i < ms / 10; i++) { now += 10; o.tick(); } };
  const attach = () => {
    o.beginDrag({ pointerId: 1, sequence: 0, screenPosition: { x: 310, y: 250 } }); advance(10);
    o.releaseDrag({ pointerId: 1, dragSessionId: 'drag-1', sequence: 1, screenPosition: { x: 310, y: 250 } }); advance(10);
  };
  const releaseAbove = (y: number) => {
    const dragSessionId = o.beginDrag({ pointerId: 1, sequence: 0, screenPosition: { x: 310, y: 250 } })!;
    advance(10);
    o.moveDrag({ pointerId: 1, dragSessionId, sequence: 1, screenPosition: { x: 310, y } });
    advance(200);
    o.releaseDrag({ pointerId: 1, dragSessionId, sequence: 2, screenPosition: { x: 310, y } });
    advance(10);
  };
  return { o, advance, attach, releaseAbove, events, unavailable: () => { available = false; }, recover: () => { available = true; },
    move: () => { surface = { ...surface, bounds: { ...surface.bounds, x: 400, y: 350 }, supportY: 350 }; } };
}
describe('user-selected external support', () => {
  it.each([170, 230])('lands on the observed window after releasing above it at y=%s', y => {
    const f = fixture(); f.releaseAbove(y);
    expect(f.o.getMotionState().phase).toBe('airborne');
    f.advance(1000);
    expect(f.o.getMotionState().position).toEqual({ x: 310, y: 250 });
    expect(f.o.getSurfaceState().externalAttachment?.surface.id).toBe('opaque:top');
    expect(f.events.filter(e => e === 'landed')).toHaveLength(1);
  });

  it('does not catch a recovered window after losing it during a released fall', () => {
    const f = fixture(); f.releaseAbove(170); f.unavailable(); f.advance(10); f.recover(); f.advance(2000);
    expect(f.o.getSurfaceState().externalAttachment).toBeUndefined();
    expect(f.o.getMotionState().position.y).toBe(790);
  });
  it('keeps a gentle release attached to the real Explorer top when its bottom overlaps the taskbar', () => {
    const f = fixture(true); f.attach(); f.advance(1000);
    expect(f.o.getMotionState().position).toEqual({ x: 310, y: 246 });
    expect(f.o.getSurfaceState().externalAttachment?.surface.kind).toBe('window_top');
    expect(f.events.filter(e => e === 'landed')).toHaveLength(1);
    expect(f.events).not.toContain('support_lost');
  });
  it('walks in support-local coordinates while the window moves', () => {
    const f = fixture(); f.attach();
    expect(f.o.requestVoluntaryMovement({ kind: 'horizontal_wander', targetRootPosition: { x: 348, y: 250 }, speedPxPerSec: 100 })).toBe(true);
    f.advance(100); f.move(); f.advance(500);
    expect(f.o.getSurfaceState().externalAttachment?.localDistancePx).toBeCloseTo(48);
    expect(f.o.getMotionState().position).toEqual({ x: 448, y: 350 });
    expect(f.o.getMotionState().velocityPxPerSec).toEqual({ x: 0, y: 0 });
  });

  it('attaches on a gentle release and follows window translation once', () => {
    const f = fixture(); f.attach();
    expect(f.o.getSurfaceState().externalAttachment?.localDistancePx).toBe(10);
    expect(f.events).toContain('ceiling_hung');
    f.move(); f.advance(10);
    expect(f.o.getMotionState().position).toEqual({ x: 410, y: 350 });
    f.advance(50);
    expect(f.o.getMotionState().position).toEqual({ x: 410, y: 350 });
    expect(f.o.getMotionState().velocityPxPerSec).toEqual({ x: 0, y: 0 });
  });
  it('falls once on loss, lands and never reattaches after recovery', () => {
    const f = fixture(); f.attach(); f.unavailable(); f.advance(10);
    expect(f.o.getMotionState().phase).toBe('airborne');
    expect(f.o.getMotionState().position.x).toBe(310);
    f.recover(); f.advance(3000);
    expect(f.o.getMotionState().phase).toBe('grounded');
    expect(f.o.getSurfaceState().externalAttachment).toBeUndefined();
    expect(f.events.filter(e => e === 'support_lost')).toHaveLength(1);
  });
  it('gives drag priority over concurrent disappearance', () => {
    const f = fixture(); f.attach(); f.unavailable();
    f.o.beginDrag({ pointerId: 2, sequence: 0, screenPosition: { x: 310, y: 250 } }); f.advance(10);
    expect(f.o.getMotionState().phase).toBe('dragged');
    expect(f.events).not.toContain('support_lost');
  });
});
