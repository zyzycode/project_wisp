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

export interface EnvironmentScreenBoundsDTO extends ScreenBoundsDTO {
  readonly id: string;
}

export interface EnvironmentSurfaceDTO {
  readonly id: string;
  readonly kind: 'screen_floor' | 'window_top' | 'unknown';
  readonly bounds: ScreenBoundsDTO;
  readonly supportY?: number;
  readonly isValidSupport: boolean;
}

export interface EnvironmentSnapshotDTO {
  readonly capturedAtMs: number;
  readonly screenBounds: EnvironmentScreenBoundsDTO;
  readonly currentSurface?: EnvironmentSurfaceDTO;
}

export interface PetDragPointerDTO {
  readonly pointerId: number;
  readonly sequence: number;
  readonly screenPosition: PetPositionDTO;
}

export interface BeginPetDragDTO extends PetDragPointerDTO {}

export interface BeginPetDragResultDTO {
  readonly dragSessionId: string;
}

export interface MovePetDragDTO extends PetDragPointerDTO {
  readonly dragSessionId: string;
}

export interface ReleasePetDragDTO extends MovePetDragDTO {}

export type PetMotionPhaseDTO = 'dragged' | 'airborne' | 'grounded';

export type PetAnimationStateDTO =
  | 'idle'
  | 'walk'
  | 'run'
  | 'dragged'
  | 'fall'
  | 'land'
  | 'stumble'
  | 'crash_landing'
  | 'recover'
  | 'settle'
  | 'sleep_start'
  | 'sleep_loop'
  | 'wake_up';

export interface PetPresentationStateDTO {
  readonly revision: number;
  readonly motionPhase: PetMotionPhaseDTO;
  readonly rootScreenPosition: PetPositionDTO;
  readonly velocityPxPerSec: PetPositionDTO;
  readonly positionAuthority: 'forced' | 'voluntary';
  readonly animationState: PetAnimationStateDTO;
}

export type CharacterInteractionTypeDTO =
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'drag_end'
  | 'pet'
  | 'play'
  | 'feed';

export interface CharacterInteractionDTO {
  type: CharacterInteractionTypeDTO;
  intensity?: number;
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
  getScreenBounds: () => Promise<ScreenBoundsDTO>;
  getEnvironmentSnapshot: () => Promise<EnvironmentSnapshotDTO>;
  onEnvironmentChanged: (callback: (snapshot: EnvironmentSnapshotDTO) => void) => () => void;
  beginPetDrag: (payload: BeginPetDragDTO) => Promise<BeginPetDragResultDTO>;
  movePetDrag: (payload: MovePetDragDTO) => Promise<void>;
  releasePetDrag: (payload: ReleasePetDragDTO) => Promise<void>;
  onPetPresentationState: (listener: (state: PetPresentationStateDTO) => void) => () => void;
  interactWithCharacter: (interaction: CharacterInteractionDTO) => Promise<void>;
  setAlwaysOnTop: (enabled: boolean) => Promise<boolean>;
  setInteractiveBounds?: (bounds: InteractiveBoundsDTO) => Promise<void>;
  setDragState?: (isDragging: boolean) => Promise<void>;
  setMenuExpanded?: (expanded: boolean) => Promise<PetPositionDTO>;
  getDebugTelemetry?: () => Promise<DebugTelemetryDTO>;
  clearDebugTelemetryLogs?: () => Promise<void>;
  onDebugTelemetry?: (listener: (telemetry: DebugTelemetryDTO) => void) => () => void;
  closeApp: () => Promise<void>;
}
