/**
 * Application Port: Platform Adapter Interface
 * Defines platform-specific operations isolated from domain and application layers.
 */
import type { SystemIdlePort } from './system-idle.port';

export interface ScreenBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SupportedPlatform = 'linux' | 'win32' | 'darwin';

export interface OverlayWindowOptions {
  readonly enableLargerThanScreen?: boolean;
}

export interface IPlatformAdapter {
  /** Absent capability is unknown; never infer user absence from pet input. */
  createSystemIdleSource?(): SystemIdlePort;
  /** Current global DIP position; null if unsupported or unavailable. Read-only, no cursor hooks. */
  getCursorScreenPosition(): { readonly x: number; readonly y: number } | null;
  getPlatformName(): SupportedPlatform;
  getDisplaySessionType(): string; // 'x11' | 'wayland' | 'native'
  getOverlayWindowOptions(): OverlayWindowOptions;
  configureOverlayWindow(window: Electron.BrowserWindow): void;
  setAlwaysOnTop(window: Electron.BrowserWindow, enabled: boolean): void;
  setIgnoreMouseEvents(window: Electron.BrowserWindow, ignore: boolean, forward?: boolean): void;
  getDisplayWorkArea(point?: { x: number; y: number }): ScreenBounds;
}
