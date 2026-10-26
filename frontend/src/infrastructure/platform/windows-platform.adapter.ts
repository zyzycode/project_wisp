import { screen, BrowserWindow } from 'electron';
import { readCursorScreenPosition } from './cursor-screen-position';
import { createSystemIdleSource } from './system-idle-source';
import type { IElectronWindowAdapter } from './electron-window-adapter.interface';
import type {
  IPlatformAdapter,
  OverlayWindowOptions,
  ScreenBounds,
  SupportedPlatform,
} from '../../application/ports/platform-adapter.interface';

export class WindowsPlatformAdapter implements IPlatformAdapter, IElectronWindowAdapter {
  createSystemIdleSource() { return createSystemIdleSource('win32'); }
  getCursorScreenPosition() { return readCursorScreenPosition(); }

  getPlatformName(): SupportedPlatform {
    return 'win32';
  }

  getDisplaySessionType(): string {
    return 'dwm';
  }

  getOverlayWindowOptions(): OverlayWindowOptions {
    return {};
  }

  configureOverlayWindow(window: BrowserWindow): void {
    this.setAlwaysOnTop(window, true);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  setAlwaysOnTop(window: BrowserWindow, enabled: boolean): void {
    window.setAlwaysOnTop(enabled, 'screen-saver');
  }

  setIgnoreMouseEvents(window: BrowserWindow, ignore: boolean, forward = true): void {
    try {
      if (ignore) {
        window.setIgnoreMouseEvents(true, { forward });
      } else {
        window.setIgnoreMouseEvents(false);
      }
    } catch (err) {
      console.warn('[WindowsPlatformAdapter] setIgnoreMouseEvents warning:', err);
    }
  }

  getDisplayWorkArea(point?: { x: number; y: number }): ScreenBounds {
    const targetDisplay = point
      ? screen.getDisplayNearestPoint(point)
      : screen.getPrimaryDisplay();

    const { x, y, width, height } = targetDisplay.workArea;
    return { x, y, width, height };
  }
}
