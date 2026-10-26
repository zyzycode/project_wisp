/**
 * Application Port: Platform Adapter Interface
 * Defines platform observations and overlay options without native window types.
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
  getDisplayWorkArea(point?: { x: number; y: number }): ScreenBounds;
}
