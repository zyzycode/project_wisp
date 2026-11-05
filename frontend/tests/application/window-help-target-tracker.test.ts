import { expect, it } from 'vitest';
import { WindowHelpTargetTracker } from '../../src/application/services/window-help-target-tracker';
import type { ExternalWindowSurfacesSnapshot } from '../../src/application/ports/external-window-surfaces.port';
import type { ExternalWindowSurface } from '../../src/domain/behavior/surface-kinematics';
const surface: ExternalWindowSurface = { id: 'opaque', kind: 'window_top', bounds: {
  x: 100, y: 100, width: 400, height: 300 }, supportY: 100, isValidSupport: true };
type NewSnapshot = Omit<Extract<ExternalWindowSurfacesSnapshot, { capability: 'available' }>, 'revision'>
  | Omit<Extract<ExternalWindowSurfacesSnapshot, { capability: 'unavailable' }>, 'revision'>;
function fixture() {
  let snapshot: ExternalWindowSurfacesSnapshot = { capability: 'available', capturedAtMs: 0, revision: 1, surfaces: [surface] };
  let listener: ((next: ExternalWindowSurfacesSnapshot) => void) | undefined;
  let policy = 0;
  const tracker = new WindowHelpTargetTracker({ getSnapshot: () => snapshot, subscribe: next => {
    listener = next; return () => { listener = undefined; };
  }, dispose: () => undefined }, { policyGeneration: () => policy,
    screen: () => ({ id: 'screen', x: 0, y: 0, width: 1000, height: 1000 }),
    insets: () => ({ left: 10, right: 10, top: 10, bottom: 10 }), feasible: () => true });
  return { tracker, policy: () => { policy++; }, next: (next: NewSnapshot) => {
    snapshot = { ...next, revision: snapshot.revision + 1 };
    listener?.(snapshot);
  } };
}
it('preserves continuity for fresh unchanged geometry, and never refreshes time on reads', () => {
  const f = fixture(), first = f.tracker.get('opaque', 0)!;
  expect(first.preview).toEqual({ region: 'upper_left', left: .1, top: .1, width: .4, height: .3 });
  expect(f.tracker.get('opaque', 301)).toBeNull();
  f.next({ capability: 'available', capturedAtMs: 200, surfaces: [surface] });
  const refreshed = f.tracker.get('opaque', 250)!;
  expect(refreshed.sourceEpoch).toBe(first.sourceEpoch);
  expect(refreshed.capturedAtMs).toBe(200);
  expect(refreshed.geometrySignature).toBe(first.geometrySignature);
});
it('invalidates identity on source recovery, geometry changes, and Main policy reset', () => {
  const f = fixture(), first = f.tracker.get('opaque', 0)!;
  f.next({ capability: 'unavailable', reason: 'bridge_failed', capturedAtMs: 10, surfaces: [] });
  f.next({ capability: 'available', capturedAtMs: 20, surfaces: [surface] });
  const recovered = f.tracker.get('opaque', 20)!;
  expect(recovered.sourceEpoch).not.toBe(first.sourceEpoch);
  f.next({ capability: 'available', capturedAtMs: 30, surfaces: [{ ...surface,
    bounds: { ...surface.bounds, width: 450 } }] });
  const changed = f.tracker.get('opaque', 30)!;
  expect(changed.sourceEpoch).not.toBe(recovered.sourceEpoch);
  f.policy(); expect(f.tracker.get('opaque', 30)?.policyGeneration).toBe(1);
});
it('rejects ambiguous coincident targets and detaches its listener without disposing shared port', () => {
  const f = fixture();
  f.next({ capability: 'available', capturedAtMs: 0, surfaces: [surface, { ...surface, id: 'other' }] });
  expect(f.tracker.get('opaque', 0)).toBeNull();
  f.tracker.dispose();
});
