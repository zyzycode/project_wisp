import { describe, expect, it, vi } from 'vitest';
import { ElectronPetPositionAdapter } from '../../src/infrastructure/adapters/electron-pet-position-adapter';

describe('Infrastructure: ElectronPetPositionAdapter', () => {
  it('translates the root pivot, clamps to the selected bounds, and skips equal integer positions', () => {
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
    expect(setPosition).toHaveBeenLastCalledWith(10, 100);
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
