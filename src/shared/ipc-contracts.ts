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

export interface SetAutonomyEnabledDTO {
  readonly enabled: boolean;
}

export type SleepWakeCommandDTO =
  | { readonly action: 'sleep' }
  | { readonly action: 'wake' };

/** Target Brain -> Body state contract for the Phase 14 atomic IPC cutover. */
export type BrainEmotionalToneDTO =
  | 'shy'
  | 'sleepy'
  | 'playful'
  | 'curious'
  | 'neutral'
  | 'affectionate'
  | 'flustered';

export type BrainVisualIntentKindDTO =
  | 'idle_blink'
  | 'walk'
  | 'settle'
  | 'sleep_start'
  | 'sleep_loop'
  | 'wake_up'
  | 'happy_reaction'
  | 'confused_reaction'
  | 'thinking_loop'
  | 'talking'
  | 'bored'
  | 'wave'
  | 'celebrate'
  | 'spook'
  | 'dragged'
  | 'land'
  | 'sit'
  | 'stand_up'
  | 'lie_down'
  | 'get_up'
  | 'run'
  | 'jump'
  | 'fall'
  | 'crawl'
  | 'climb_wall'
  | 'hang_ceiling'
  | 'crash_landing';

export interface BrainNeedsDTO {
  readonly energy: number;
  readonly attention: number;
  readonly play: number;
  readonly comfort: number;
  readonly boredom: number;
}

export interface BrainActivityTimelineDTO {
  readonly runId: string;
  readonly activityId: string;
  readonly phaseId: string;
  readonly stage: 'entering' | 'looping' | 'exiting';
  readonly startedAtMs: number;
  readonly phaseStartedAtMs: number;
  readonly phaseEndsAtMs: number | null;
}

export interface BrainMotionStateDTO {
  readonly phase: 'dragged' | 'airborne' | 'grounded';
  readonly rootScreenPosition: { readonly x: number; readonly y: number };
  readonly velocityPxPerSec: { readonly x: number; readonly y: number };
  readonly positionAuthority: 'forced' | 'voluntary';
}

export interface BrainVisualIntentDTO {
  readonly episodeId: string;
  readonly episodeStartedAtMs: number;
  readonly kind: BrainVisualIntentKindDTO;
  readonly category:
    | 'idle'
    | 'movement'
    | 'reaction'
    | 'dialogue'
    | 'sleep'
    | 'gesture'
    | 'transition'
    | 'physics';
  readonly priority: 'low' | 'normal' | 'high' | 'critical';
  readonly interrupt: 'yes' | 'no' | 'limited';
  readonly loop: 'none' | 'until_replaced' | 'bounded';
  readonly emotionalTone: BrainEmotionalToneDTO;
  readonly expressionHint?:
    | 'idle'
    | 'blush'
    | 'happy'
    | 'winking'
    | 'pout'
    | 'curious'
    | 'thinking'
    | 'sleepy'
    | 'surprised'
    | 'shocked'
    | 'sad'
    | 'angry'
    | 'talking'
    | 'flying'
    | 'gaze'
    | 'dizzy'
    | 'flirty';
  readonly gazeDirection?: 'left' | 'right' | 'up' | 'down';
  readonly propHint?: 'pillow' | 'heart' | 'question' | 'sparkle' | 'none';
}

export interface BrainStateDTO {
  readonly streamId: string;
  readonly revision: number;
  readonly sampledAtMs: number;
  readonly character: {
    readonly needs: BrainNeedsDTO;
    readonly synthesizedTone: BrainEmotionalToneDTO;
  };
  readonly activity: BrainActivityTimelineDTO | null;
  readonly motion: BrainMotionStateDTO;
  readonly visualIntent: BrainVisualIntentDTO;
}

export interface BodyEventMetaDTO {
  readonly streamId: string;
  readonly sequence: number;
  readonly basedOnRevision: number;
  readonly observedAtMs: number;
}

export type BodyEventDTO =
  | (BodyEventMetaDTO & {
      readonly type: 'cursor_observed';
      readonly screenPosition: { readonly x: number; readonly y: number };
    })
  | (BodyEventMetaDTO & {
      readonly type: 'interaction';
      readonly interaction:
        | 'click'
        | 'double_click'
        | 'right_click'
        | 'pet'
        | 'play'
        | 'feed'
        | 'think';
      readonly intensity?: number;
    })
  | (BodyEventMetaDTO & {
      readonly type: 'drag_started' | 'drag_moved';
      readonly gestureId: string;
      readonly pointerId: number;
      readonly screenPosition: { readonly x: number; readonly y: number };
    })
  | (BodyEventMetaDTO & {
      readonly type: 'drag_ended';
      readonly gestureId: string;
      readonly pointerId: number;
      readonly screenPosition: { readonly x: number; readonly y: number };
      readonly cancelled: boolean;
    })
  | (BodyEventMetaDTO & {
      readonly type: 'menu_visibility_changed';
      readonly expanded: boolean;
    });

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
  updatePosition?: (targetPos: PetPositionDTO) => Promise<PetPositionDTO>;
  setAutonomyEnabled?: (payload: SetAutonomyEnabledDTO) => Promise<void>;
  requestSleepWake: (command: SleepWakeCommandDTO) => Promise<void>;
  onBrainState: (listener: (state: BrainStateDTO) => void) => () => void;
  postBodyEvent: (event: BodyEventDTO) => Promise<void>;
  getScreenBounds: () => Promise<ScreenBoundsDTO>;
  getEnvironmentSnapshot: () => Promise<EnvironmentSnapshotDTO>;
  onEnvironmentChanged: (callback: (snapshot: EnvironmentSnapshotDTO) => void) => () => void;
  beginPetDrag: (payload: BeginPetDragDTO) => Promise<BeginPetDragResultDTO>;
  movePetDrag: (payload: MovePetDragDTO) => Promise<void>;
  releasePetDrag: (payload: ReleasePetDragDTO) => Promise<void>;
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
