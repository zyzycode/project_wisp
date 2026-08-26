import { screen, BrowserWindow } from 'electron';
import type {
  IPlatformAdapter,
  ScreenBounds,
  SupportedPlatform,
} from '../../application/ports/platform-adapter.interface';

export class LinuxPlatformAdapter implements IPlatformAdapter {
  getPlatformName(): SupportedPlatform {
    return 'linux';
  }

  getDisplaySessionType(): string {
    return process.env.XDG_SESSION_TYPE?.toLowerCase() || 'x11';
  }

  configureOverlayWindow(window: BrowserWindow): void {
    // Use 'floating' on Linux to avoid Mutter/GNOME treating window as a screen saver
    window.setAlwaysOnTop(true, 'floating');
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
      console.warn('[LinuxPlatformAdapter] setIgnoreMouseEvents warning:', err);
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
