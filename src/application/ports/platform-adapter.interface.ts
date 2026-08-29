/**
 * Application Port: Platform Adapter Interface
 * Defines platform-specific operations isolated from domain and application layers.
 */

export interface ScreenBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SupportedPlatform = 'linux' | 'win32' | 'darwin';

export interface IPlatformAdapter {
  getPlatformName(): SupportedPlatform;
  getDisplaySessionType(): string; // 'x11' | 'wayland' | 'native'
  configureOverlayWindow(window: Electron.BrowserWindow): void;
  setAlwaysOnTop(window: Electron.BrowserWindow, enabled: boolean): void;
  setIgnoreMouseEvents(window: Electron.BrowserWindow, ignore: boolean, forward?: boolean): void;
  getDisplayWorkArea(point?: { x: number; y: number }): ScreenBounds;
}
