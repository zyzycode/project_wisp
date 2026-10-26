import { describe, it, expect, vi } from 'vitest';
import { LinuxPlatformAdapter } from '../../src/infrastructure/platform/linux-platform.adapter';
import { WindowsPlatformAdapter } from '../../src/infrastructure/platform/windows-platform.adapter';
import { MacOSPlatformAdapter } from '../../src/infrastructure/platform/macos-platform.adapter';
import { createPlatformAdapter } from '../../src/infrastructure/platform/platform-adapter.factory';

// Mock electron modules
vi.mock('electron', () => {
  return {
    screen: {
      getPrimaryDisplay: () => ({
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      }),
      getDisplayNearestPoint: () => ({
        workArea: { x: 1920, y: 0, width: 1920, height: 1080 },
      }),
    },
    BrowserWindow: vi.fn(),
  };
});

describe('Platform Adapters', () => {
  it('allows a frameless macOS overlay origin outside the display to preserve its contact root', () => {
    expect(new MacOSPlatformAdapter().getOverlayWindowOptions()).toEqual({ enableLargerThanScreen: true });
  });

  it('getDisplayWorkArea returns correct screen bounds', () => {
    const adapter = new LinuxPlatformAdapter();
    const bounds = adapter.getDisplayWorkArea();
    expect(bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
  });

  it('createPlatformAdapter returns appropriate adapter for the runtime environment', () => {
    const adapter = createPlatformAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.getPlatformName()).toBe('string');
  });

  it.each([
    ['Linux', new LinuxPlatformAdapter(), 'floating'],
    ['Windows', new WindowsPlatformAdapter(), 'screen-saver'],
    ['macOS', new MacOSPlatformAdapter(), 'floating'],
  ] as const)('%s adapter toggles native always-on-top state', (_name, adapter, level) => {
    const setAlwaysOnTop = vi.fn();
    const window = { setAlwaysOnTop } as unknown as Electron.BrowserWindow;

    adapter.setAlwaysOnTop(window, false);
    adapter.setAlwaysOnTop(window, true);

    expect(setAlwaysOnTop).toHaveBeenNthCalledWith(1, false, level);
    expect(setAlwaysOnTop).toHaveBeenNthCalledWith(2, true, level);
  });

  it('keeps the Linux overlay interactive when ignored-event forwarding is unavailable', () => {
    const adapter = new LinuxPlatformAdapter();
    const setIgnoreMouseEvents = vi.fn();
    const window = { setIgnoreMouseEvents } as unknown as Electron.BrowserWindow;

    adapter.setIgnoreMouseEvents(window, true, true);
    adapter.setIgnoreMouseEvents(window, true, false);

    expect(setIgnoreMouseEvents).toHaveBeenNthCalledWith(1, false);
    expect(setIgnoreMouseEvents).toHaveBeenNthCalledWith(2, true);
  });
});
