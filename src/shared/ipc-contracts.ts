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

export interface InteractiveBoundsDTO {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DebugLogLevelDTO = 'debug' | 'info' | 'warn' | 'error';
export type DebugLogContextDTO = 'FSM' | 'CharacterEngine' | 'Needs' | 'AIProvider' | 'RenderEngine' | 'IPC' | 'Autonomy';

export interface DebugLogEntryDTO {
  id: string;
  level: DebugLogLevelDTO;
  context: DebugLogContextDTO;
  message: string;
  createdAt: string;
}

export interface CharacterDebugStateDTO {
  needs: { energy: number; attention: number; play: number; comfort: number };
  relationship: { friendship: number; love: number; loveUnlocked: boolean };
  synthesizedTone: 'shy' | 'sleepy' | 'playful' | 'curious' | 'neutral' | 'affectionate' | 'flustered';
  lastUpdated: number;
}

export interface DebugTelemetryDTO {
  character: CharacterDebugStateDTO;
  logs: readonly DebugLogEntryDTO[];
}

export interface WispApiBridge {
  readonly debugEnabled: boolean;
  ping: (message: string) => Promise<PingResponseDTO>;
  getSystemInfo: () => Promise<SystemInfoDTO>;
  setIgnoreMouseEvents: (payload: IgnoreMouseEventsDTO) => Promise<void>;
  getPosition: () => Promise<PetPositionDTO>;
  updatePosition: (pos: PetPositionDTO) => Promise<PetPositionDTO>;
  getScreenBounds: () => Promise<ScreenBoundsDTO>;
  setInteractiveBounds?: (bounds: InteractiveBoundsDTO) => Promise<void>;
  setDragState?: (isDragging: boolean) => Promise<void>;
  getDebugTelemetry?: () => Promise<DebugTelemetryDTO>;
  clearDebugTelemetryLogs?: () => Promise<void>;
  onDebugTelemetry?: (listener: (telemetry: DebugTelemetryDTO) => void) => () => void;
  closeApp: () => Promise<void>;
}
