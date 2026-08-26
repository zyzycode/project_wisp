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
    // On Linux X11/Wayland, setting alwaysOnTop with 'screen-saver' ensures overlay stays visible above all panels/windows
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  setIgnoreMouseEvents(window: BrowserWindow, ignore: boolean, forward = true): void {
    try {
      window.setIgnoreMouseEvents(ignore, { forward });
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
