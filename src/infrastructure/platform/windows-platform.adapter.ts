import { screen, BrowserWindow } from 'electron';
import type {
  IPlatformAdapter,
  ScreenBounds,
  SupportedPlatform,
} from '../../application/ports/platform-adapter.interface';

export class WindowsPlatformAdapter implements IPlatformAdapter {
  getPlatformName(): SupportedPlatform {
    return 'win32';
  }

  getDisplaySessionType(): string {
    return 'dwm';
  }

  configureOverlayWindow(window: BrowserWindow): void {
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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
