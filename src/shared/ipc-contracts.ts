/**
 * Shared IPC Contracts and DTOs for Project Wisp
 * This file is shared between Main, Preload and Renderer layers.
 * Only serializable data types and strict interfaces allowed.
 */

export interface SystemInfoDTO {
  platform: 'linux' | 'win32' | 'darwin';
  sessionType: string;
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
}

export interface PingResponseDTO {
  reply: string;
  timestamp: number;
}

export interface IgnoreMouseEventsDTO {
  ignore: boolean;
  forward?: boolean;
}

export interface PetPositionDTO {
  x: number;
  y: number;
}

export interface ScreenBoundsDTO {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WispApiBridge {
  ping: (message: string) => Promise<PingResponseDTO>;
  getSystemInfo: () => Promise<SystemInfoDTO>;
  setIgnoreMouseEvents: (payload: IgnoreMouseEventsDTO) => Promise<void>;
  getPosition: () => Promise<PetPositionDTO>;
  updatePosition: (pos: PetPositionDTO) => Promise<PetPositionDTO>;
  getScreenBounds: () => Promise<ScreenBoundsDTO>;
  closeApp: () => Promise<void>;
}
