import { expect, it, vi } from 'vitest';
import { BrainActivityRuntime } from '../../src/application/services/brain-activity-runtime';
import type { BehaviorIntent } from '../../src/domain/behavior/behavior-intent';
const intent: BehaviorIntent = { kind: 'wander', source: 'timer', priority: 'normal', reason: 'local_utility' };
function fixture(eligible: boolean, traversal = false) {
  const snapshot = { needs: { energy: 70, attention: 0, play: 0, comfort: 70, boredom: 90 }, synthesizedTone: 'neutral' as const };
  const bounds = { id: 'screen', x: 0, y: 0, width: 1000, height: 800 };
  const random = vi.fn(() => .999), committed = vi.fn(), visual = vi.fn();
  const runtime = new BrainActivityRuntime({ clock: { now: () => 0 }, getCharacterSnapshot: () => snapshot,
    getSelectionContext: () => ({ character: snapshot, synthesizedTone: 'neutral', environment: {
      capturedAtMs: 0, screenBounds: bounds, currentSurface: { id: 'floor', kind: 'screen_floor', bounds, isValidSupport: true },
    } }), getRootPosition: () => ({ x: 100, y: 790 }), getCollisionInsets: () => ({ left: 50, right: 50, top: 90, bottom: 10 }),
    getExternalSurfaces: () => [{ id: 'target', kind: 'window_top', bounds: { x: 300, y: 400, width: 300, height: 200 },
      supportY: 400, isValidSupport: true }], canRequestWindowHelp: () => eligible, traversalEnabled: traversal,
    nextRandom: random, requestLocomotion: () => true, cancelLocomotion: () => false,
    createRunId: () => 'run', onRunCommitted: committed, onVisualIntent: visual, onTerminated: vi.fn() });
  return { runtime, random, committed, visual };
}
it('makes one actual weighted target choice and reports manual preparation without starting or recording an Explore visit', () => {
  const f = fixture(true);
  expect(f.runtime.canStart(intent)).toBe(true); expect(f.random).not.toHaveBeenCalled();
  const prepared = f.runtime.prepareResolved(intent);
  expect(prepared).toMatchObject({ kind: 'needs_manual_support', plan: { surfaceId: 'target' } });
  expect(f.random).toHaveBeenCalledOnce();
  expect(f.runtime.getRuntime()).toBeNull(); expect(f.runtime.getExplorePlan()).toBeNull();
  expect(f.committed).not.toHaveBeenCalled(); expect(f.visual).not.toHaveBeenCalled();
  expect(prepared && f.runtime.startPrepared(intent, prepared)).toBe(false);
});
it('excludes manual-only targets before selection without consent, while real autonomous routes remain Explore', () => {
  const blocked = fixture(false), routed = fixture(true, true);
  expect(blocked.runtime.prepareResolved(intent)).toMatchObject({ kind: 'execute', plan: { surfaceKind: 'screen_floor' } });
  const prepared = routed.runtime.prepareResolved(intent);
  expect(prepared).toMatchObject({ kind: 'execute', plan: { surfaceKind: 'window_top' } });
  expect(prepared && routed.runtime.startPrepared(intent, prepared)).toBe(true);
  expect(routed.random).toHaveBeenCalledOnce(); expect(routed.committed).toHaveBeenCalledOnce();
});
