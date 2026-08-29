import { screen, BrowserWindow } from 'electron';
import type {
  IPlatformAdapter,
  ScreenBounds,
  SupportedPlatform,
} from '../../application/ports/platform-adapter.interface';

export class MacOSPlatformAdapter implements IPlatformAdapter {
  getPlatformName(): SupportedPlatform {
    return 'darwin';
  }

  getDisplaySessionType(): string {
    return 'cocoa';
  }

  configureOverlayWindow(window: BrowserWindow): void {
    this.setAlwaysOnTop(window, true);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  setAlwaysOnTop(window: BrowserWindow, enabled: boolean): void {
    window.setAlwaysOnTop(enabled, 'floating');
  }

  setIgnoreMouseEvents(window: BrowserWindow, ignore: boolean, forward = true): void {
    try {
      if (ignore) {
        window.setIgnoreMouseEvents(true, { forward });
      } else {
        window.setIgnoreMouseEvents(false);
      }
    } catch (err) {
      console.warn('[MacOSPlatformAdapter] setIgnoreMouseEvents warning:', err);
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
