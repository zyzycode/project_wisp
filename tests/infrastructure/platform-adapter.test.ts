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
  it('LinuxPlatformAdapter returns correct platform name and session type', () => {
    const adapter = new LinuxPlatformAdapter();
    expect(adapter.getPlatformName()).toBe('linux');
    expect(['x11', 'wayland']).toContain(adapter.getDisplaySessionType());
  });

  it('WindowsPlatformAdapter returns win32 platform name', () => {
    const adapter = new WindowsPlatformAdapter();
    expect(adapter.getPlatformName()).toBe('win32');
    expect(adapter.getDisplaySessionType()).toBe('dwm');
  });

  it('MacOSPlatformAdapter returns darwin platform name', () => {
    const adapter = new MacOSPlatformAdapter();
    expect(adapter.getPlatformName()).toBe('darwin');
    expect(adapter.getDisplaySessionType()).toBe('cocoa');
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
});
