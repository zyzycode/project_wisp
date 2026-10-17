import { describe, expect, it, vi } from 'vitest';
import {
  ElectronPetPositionAdapter,
  nativeToRootPosition,
  rootToNativePosition,
} from '../../src/infrastructure/adapters/electron-pet-position-adapter';
import { PET_PRESENTATION_LAYOUT, calculateWindowRootPivotOffset } from '../../src/shared/pet-presentation-layout';
import { calculateRootCollisionRange, DEFAULT_MOTION_CONSTRAINTS } from '../../src/domain/behavior/motion-engine';

describe('Infrastructure: ElectronPetPositionAdapter', () => {
  it.each([
    { id: 'primary', x: 0, y: 0, width: 1440, height: 900 },
    { id: 'left', x: -1440, y: -200, width: 1440, height: 900 },
  ])('preserves screen-wall contact through the current scaled layout on $id', bounds => {
    const pivotOffset = calculateWindowRootPivotOffset(PET_PRESENTATION_LAYOUT);
    const range = calculateRootCollisionRange(bounds, DEFAULT_MOTION_CONSTRAINTS.collisionInsets);
    for (const x of [range.minX, range.maxX]) {
      for (const y of [range.maxY, bounds.y + 400, range.minY]) {
        const renderedRoot = nativeToRootPosition(rootToNativePosition({ x, y }, bounds, pivotOffset), pivotOffset);
        expect(Math.abs(renderedRoot.x - x)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(renderedRoot.y - y)).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('keeps the rendered sprite root on the Windows work-area floor', () => {
    const pivotOffset = { x: 140, y: 233.625 };
    const bounds = { id: 'primary', x: 0, y: 0, width: 1_920, height: 1_080 };
    const nativePosition = rootToNativePosition(
      { x: 960, y: 1_070 },
      bounds,
      pivotOffset
    );

    expect(nativePosition).toEqual({ x: 820, y: 836 });
    expect(nativePosition.y + pivotOffset.y).toBeCloseTo(1_070, 0);
  });

  it('translates the root pivot, clamps root bounds, and skips equal integer positions', () => {
    const setPosition = vi.fn();
    const window = { isDestroyed: () => false, setPosition } as unknown as Electron.BrowserWindow;
    const adapter = new ElectronPetPositionAdapter({
      getWindow: () => window,
      pivotOffset: { x: 20, y: 30 },
    });
    const bounds = { id: 'display-1', x: 10, y: 20, width: 100, height: 80 };

    adapter.commitRootPosition({ rootPosition: { x: 40.4, y: 60.4 }, bounds });
    adapter.commitRootPosition({ rootPosition: { x: 40.49, y: 60.49 }, bounds });
    adapter.commitRootPosition({ rootPosition: { x: -100, y: 999 }, bounds });

    expect(setPosition).toHaveBeenNthCalledWith(1, 20, 30);
    expect(setPosition).toHaveBeenCalledTimes(2);
    expect(setPosition).toHaveBeenLastCalledWith(-10, 70);
  });

  it('does nothing for an unavailable or destroyed window', () => {
    const destroyedWindow = { isDestroyed: () => true, setPosition: vi.fn() } as unknown as Electron.BrowserWindow;
    const adapter = new ElectronPetPositionAdapter({
      getWindow: () => destroyedWindow,
      pivotOffset: { x: 0, y: 0 },
    });
    adapter.commitRootPosition({
      rootPosition: { x: 10, y: 10 },
      bounds: { id: 'display-1', x: 0, y: 0, width: 100, height: 100 },
    });

    expect(destroyedWindow.setPosition).not.toHaveBeenCalled();
  });
});
