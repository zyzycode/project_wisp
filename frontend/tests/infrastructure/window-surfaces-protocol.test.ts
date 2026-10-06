import { describe, expect, it, vi } from 'vitest';
import { normalizeBridgeWindows, parseBridgeResponse, type BridgeWindow } from '../../src/infrastructure/platform/window-surfaces-protocol';
const row: BridgeWindow = { token: 'a'.repeat(32), x: 100, y: 100, width: 200, height: 200, top: true, left: false, right: true };

describe('AUTO-I05 bridge schema and DIP normalization', () => {
  it.each([
    { x: 207, y: 425, width: 1561, height: 756 },
    { x: 486, y: 512, width: 1282, height: 721 },
  ])('keeps a complete visible top when only the bottom leaves the desktop: %j', frame => {
    const result = normalizeBridgeWindows([{ ...row, ...frame, top: true, left: true, right: true }], [{
      physicalBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1032 },
    }], bounds => bounds, 'epoch');
    expect(result).toEqual([expect.objectContaining({ kind: 'window_top', supportY: frame.y, bounds: frame })]);
  });

  it('does not accept an offscreen-bottom window when its body spans a lower monitor', () => {
    const convert = vi.fn(bounds => bounds);
    const result = normalizeBridgeWindows([{ ...row, x: 207, y: 425, width: 1561, height: 756 }], [
      { physicalBounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1032 } },
      { physicalBounds: { x: 0, y: 1080, width: 1920, height: 1080 }, workArea: { x: 0, y: 1080, width: 1920, height: 1032 } },
    ], convert, 'epoch');
    expect(result).toEqual([]);
    expect(convert).not.toHaveBeenCalled();
  });

  it('still excludes frames with no display intersection or a partially offscreen top', () => {
    const displays = [{ physicalBounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1032 } }];
    expect(normalizeBridgeWindows([{ ...row, x: 2000 }], displays, bounds => bounds, 'epoch')).toEqual([]);
    expect(normalizeBridgeWindows([{ ...row, x: -100, right: false }], displays, bounds => bounds, 'epoch')).toEqual([]);
  });
  it('retains the Explorer top when its bottom extends under the taskbar, without clipping bounds', () => {
    const explorer = { ...row, x: 167, y: 246, width: 1561, height: 815, left: true, right: true };
    const result = normalizeBridgeWindows([explorer], [{
      physicalBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1032 },
    }], bounds => bounds, 'epoch');
    expect(result).toEqual([expect.objectContaining({ kind: 'window_top', supportY: 246,
      bounds: { x: 167, y: 246, width: 1561, height: 815 } })]);
  });

  it('checks each complete edge against a left taskbar and never invents clipped edges', () => {
    const result = normalizeBridgeWindows([{ ...row, x: 20, left: true }], [{
      physicalBounds: { x: 0, y: 0, width: 1000, height: 800 },
      workArea: { x: 50, y: 0, width: 950, height: 800 },
    }], bounds => bounds, 'epoch');
    expect(result).toEqual([expect.objectContaining({ kind: 'window_side', side: 'right',
      bounds: { x: 20, y: 100, width: 200, height: 200 } })]);
  });
  it.each([{ ...row, pid: 42 }, { ...row, title: 'private' }, { ...row, token: '0x123' }, { ...row, width: 0 }, { ...row, top: 1 }])('rejects native metadata and malformed records atomically', value => {
    expect(() => parseBridgeResponse({ requestId: 1, windows: [row, value] }, 1)).toThrow();
  });
  it('rejects duplicate tokens, oversized snapshots, and wrong request identities', () => {
    expect(() => parseBridgeResponse({ requestId: 1, windows: [row, row] }, 1)).toThrow();
    expect(() => parseBridgeResponse({ requestId: 1, windows: Array(513).fill(row) }, 1)).toThrow();
    expect(() => parseBridgeResponse({ requestId: 2, windows: [] }, 1)).toThrow();
  });
  it.each([1, 1.5, 2])('converts one physical frame once at scale %s and publishes only visible edges', scale => {
    const convert = vi.fn(() => ({ x: -400, y: 100, width: 200, height: 200 }));
    const result = normalizeBridgeWindows([row], [{ physicalBounds: { x: 0, y: 0, width: 1000 * scale, height: 800 * scale },
      workArea: { x: -500, y: 0, width: 1000, height: 800 } }], convert, 'epoch');
    expect(convert).toHaveBeenCalledExactlyOnceWith({ x: 100, y: 100, width: 200, height: 200 });
    expect(result.map(surface => surface.kind)).toEqual(['window_top', 'window_side']);
    expect(result[0]).toMatchObject({ supportY: 100, bounds: { x: -400, width: 200 } });
    expect(JSON.stringify(result)).not.toMatch(/pid|handle|title|scaleFactor/);
    expect(Object.isFrozen(result[0]!.bounds)).toBe(true);
  });
  it('excludes spanning windows before conversion and never clips a frame into a fake edge', () => {
    const convert = vi.fn(() => ({ x: 100, y: 100, width: 200, height: 200 }));
    const displays = [0, 200].map(x => ({ physicalBounds: { x, y: 0, width: 200, height: 800 }, workArea: { x, y: 0, width: 200, height: 800 } }));
    expect(normalizeBridgeWindows([row], displays, convert, 'epoch')).toEqual([]);
    expect(convert).not.toHaveBeenCalled();
    expect(normalizeBridgeWindows([row], [{ physicalBounds: { x: 0, y: 0, width: 1000, height: 800 }, workArea: { x: 0, y: 0, width: 250, height: 800 } }], convert, 'epoch')).toEqual([]);
  });
});
