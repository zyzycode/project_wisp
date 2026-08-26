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
    window.setAlwaysOnTop(true, 'floating');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  setIgnoreMouseEvents(window: BrowserWindow, ignore: boolean, forward = true): void {
    try {
      window.setIgnoreMouseEvents(ignore, { forward });
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
