import { screen, BrowserWindow } from 'electron';
import type {
  IPlatformAdapter,
  ScreenBounds,
  SupportedPlatform,
} from '../../application/ports/platform-adapter.interface';

/**
 * LinuxPlatformAdapter handles platform-specific window features for Linux.
 *
 * Linux Window Manager & Protocol Considerations:
 * 1. X11 / XWayland:
 *    - Native `BrowserWindow.setPosition()` and `setAlwaysOnTop(true, 'floating')` are fully supported.
 *    - Transparency is managed by X11 compositors (Mutter, KWin, Picom).
 *
 * 2. Pure Native Wayland:
 *    - The Wayland security protocol restricts client applications from setting arbitrary global screen coordinates.
 *    - Electron on Linux defaults to XWayland unless explicitly run with Ozone Wayland flags.
 *    - Under native Wayland, if `setPosition()` is constrained by the compositor, the window safely remains at its
 *      initial position without throwing unhandled exceptions.
 */
export class LinuxPlatformAdapter implements IPlatformAdapter {
  getPlatformName(): SupportedPlatform {
    return 'linux';
  }

  getDisplaySessionType(): string {
    return process.env.XDG_SESSION_TYPE?.toLowerCase() || 'x11';
  }

  configureOverlayWindow(window: BrowserWindow): void {
    // 'floating' level ensures window remains above regular apps in GNOME/Mutter without screensaver layer bugs
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
    try {
      const targetDisplay = point
        ? screen.getDisplayNearestPoint(point)
        : screen.getPrimaryDisplay();

      const { x, y, width, height } = targetDisplay.workArea;
      return { x, y, width, height };
    } catch {
      // Safe fallback if screen query fails under Wayland
      const primary = screen.getPrimaryDisplay();
      return { x: 0, y: 0, width: primary?.workArea?.width || 1920, height: primary?.workArea?.height || 1080 };
    }
  }
}
