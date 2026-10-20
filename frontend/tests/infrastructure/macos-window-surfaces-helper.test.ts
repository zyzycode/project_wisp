import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { MACOS_WINDOW_SURFACES_HELPER } from '../../src/infrastructure/platform/macos-window-surfaces-helper';
import { parseBridgeResponse, normalizeBridgeWindows } from '../../src/infrastructure/platform/window-surfaces-protocol';
function fixture() {
  let windows: unknown = [], serial = 0;
  const policy = new Map<number, number>();
  const context = {
    ObjC: { import: () => {}, bindFunction: () => {}, deepUnwrap: (v: unknown) => v, castRefToObject: (v: unknown) => v, unwrap: (v: unknown) => v },
    $: Object.assign((value: unknown) => value, {
      NSProcessInfo: { processInfo: { processIdentifier: 9 } },
      CGWindowListCopyWindowInfo: () => Array.isArray(windows) ? { isNil: () => false, count: windows.length, objectAtIndex: (i: number) => ({ objectForKey: (key: string) => { const w: Record<string, unknown> = (windows as Record<string, unknown>[])[i]!; return w[key]; } }) } : null,
      CFRelease: () => {},
      NSRunningApplication: { runningApplicationWithProcessIdentifier: (pid: number) => ({ isNil: () => false, activationPolicy: policy.get(pid) ?? 0 }) },
      NSUUID: { get UUID() { return { UUIDString: (++serial).toString(16).padStart(32, '0') }; } },
    }),
  };
  const sample: (request: string) => unknown = runInNewContext(MACOS_WINDOW_SURFACES_HELPER + '\nsample;', context);
  let sequence = 0;
  return { set: (value: unknown) => { windows = value; }, policy,
    read: () => { const id = ++sequence; return parseBridgeResponse(sample(`${id} 42`), id); } };
}
const window = (id = 1, extra: object = {}) => ({ kCGWindowNumber: id, kCGWindowOwnerPID: 7,
  kCGWindowLayer: 0, kCGWindowAlpha: 1, kCGWindowBounds: { X: 100, Y: 100, Width: 200, Height: 200 }, ...extra });
describe('macOS bundled helper with mocked native metadata', () => {
  it('preserves identity on move/resize and forgets absent/minimized or filtered windows', () => {
    const f = fixture(); f.set([window()]); const first = f.read()[0]!.token;
    f.set([window(1, { kCGWindowBounds: { X: -100.5, Y: 120, Width: 210, Height: 200 } })]);
    expect(f.read()[0]).toMatchObject({ token: first, x: -100.5, y: 120, width: 210 });
    f.set([]); expect(f.read()).toEqual([]); f.set([window()]); expect(f.read()[0]!.token).not.toBe(first);
    f.set([window(1, { kCGWindowAlpha: 0 })]); expect(f.read()).toEqual([]);
  });
  it('keeps panels and translucent windows as occluders but excludes own processes', () => {
    const f = fixture();
    const overlay = window(2, { kCGWindowLayer: 3, kCGWindowAlpha: .5,
      kCGWindowBounds: { X: 90, Y: 90, Width: 60, Height: 30 } });
    f.set([overlay, window()]); expect(f.read()).toMatchObject([{ top: false, left: false, right: true }]);
    f.set([{ ...overlay, kCGWindowOwnerPID: 42 }, window()]); expect(f.read()).toMatchObject([{ top: true, left: true, right: true }]);
    f.policy.set(7, 1); expect(f.read()).toEqual([]);
  });
  it('changes identity for a reused number with another owner and rejects corrupt snapshots', () => {
    const f = fixture(); f.set([window()]); const token = f.read()[0]!.token;
    f.set([window(1, { kCGWindowOwnerPID: 8 })]); expect(f.read()[0]!.token).not.toBe(token);
    f.set([window(2, { kCGWindowBounds: null }), window()]); expect(() => f.read()).toThrow('Unknown geometry');
    f.set(null); expect(() => f.read()).toThrow();
  });
  it('normalizes logical points including negative origins without Retina scaling; spanning is rejected', () => {
    const f = fixture(); f.set([window(1, { kCGWindowBounds: { X: -800.5, Y: 100, Width: 200, Height: 200 } })]);
    const display = { physicalBounds: { x: -1000, y: 0, width: 1000, height: 900 }, workArea: { x: -1000, y: 30, width: 1000, height: 870 } };
    expect(normalizeBridgeWindows(f.read(), [display], b => b, 'epoch')[0]?.bounds.x).toBe(-800.5);
    f.set([window(1, { kCGWindowBounds: { X: -100, Y: 100, Width: 200, Height: 200 } })]);
    expect(normalizeBridgeWindows(f.read(), [display, { physicalBounds: { x: 0, y: 0, width: 1000, height: 900 }, workArea: display.workArea }], b => b, 'epoch')).toEqual([]);
  });
});
