/**
 * Shared IPC Contracts and DTOs for Project Wisp
 * This file is shared between Main, Preload and Renderer layers.
 * Only serializable data types and strict interfaces allowed.
 */

/** Static presentation configuration shared by Main and Renderer; no new IPC channel. */
export interface PetPresentationLayoutDTO {
  /** Native window size and character rectangle in Electron DIP / CSS pixels. */
  readonly compactWindowSize: { readonly width: number; readonly height: number };
  readonly expandedWindowSize: { readonly width: number; readonly height: number };
  /** Character origin stays fixed when the context menu expands the window. */
  readonly characterRect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** Canonical source-canvas coordinates, independent of the current animation. */
  readonly spriteViewport: { readonly width: number; readonly height: number };
  readonly spriteRootPivot: { readonly x: number; readonly y: number };
}

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
  | 'look_around'
  | 'crouch_examine'
  | 'edge_peek'
  | 'surface_touch'
  | 'talking'
  | 'bored'
  | 'wave'
  | 'celebrate'
  | 'spook'
  | 'dragged'
  | 'land'
  | 'sit'
  | 'sit_edge'
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
  readonly dialogue: DialoguePresentationDTO;
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

/** Dialogue commands use their own sequence within the Brain stream. */
export interface DialogueCommandMetaDTO {
  readonly streamId: string;
  readonly conversationId: string;
  /** Increasing per Brain stream; independent of BodyEventDTO.sequence. */
  readonly sequence: number;
}

export type DialogueCommandDTO = DialogueCommandMetaDTO & (
  | { readonly type: 'send'; readonly text: string }
  | { readonly type: 'reset' }
);

/** Admission only; replies and lifecycle are delivered in the complete Brain snapshot. */
export type DialogueCommandReceiptDTO =
  | { readonly status: 'accepted'; readonly conversationId: string }
  | {
      readonly status: 'rejected';
      readonly reason: 'busy' | 'stale' | 'invalid_input' | 'unavailable';
    };

export type DialogueFallbackReasonDTO =
  | 'degraded'
  | 'offline'
  | 'timeout'
  | 'provider_error'
  | 'invalid_response';

export type DialogueTurnPresentationDTO =
  | { readonly phase: 'idle' }
  | { readonly phase: 'thinking'; readonly requestId: string }
  | {
      readonly phase: 'completed';
      readonly requestId: string;
      readonly replyText: string;
      readonly outcome:
        | { readonly kind: 'success' }
        | { readonly kind: 'fallback'; readonly reason: DialogueFallbackReasonDTO };
    }
  | {
      readonly phase: 'error';
      readonly requestId: string;
      readonly message: string;
    };

export interface DialoguePresentationDTO {
  readonly conversationId: string;
  /** False while a provider call is outstanding, including a retired timed-out call. */
  readonly canSubmit: boolean;
  readonly turn: DialogueTurnPresentationDTO;
}

export type BodyInteractionTypeDTO =
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'pet'
  | 'play'
  | 'feed'
  | 'think';

export type BodyEventDTO =
  | (BodyEventMetaDTO & {
      readonly type: 'cursor_observed';
      readonly screenPosition: { readonly x: number; readonly y: number };
    })
  | (BodyEventMetaDTO & {
      readonly type: 'interaction';
      readonly interaction: BodyInteractionTypeDTO;
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
  readonly kind: 'screen_floor' | 'window_top' | 'window_side' | 'unknown';
  readonly bounds: ScreenBoundsDTO;
  readonly supportY?: number;
  /** Target AUTO-A07 projection: required only for window_side. */
  readonly side?: 'left' | 'right';
  readonly isValidSupport: boolean;
}

export interface EnvironmentSnapshotDTO {
  readonly capturedAtMs: number;
  readonly screenBounds: EnvironmentScreenBoundsDTO;
  readonly currentSurface?: EnvironmentSurfaceDTO;
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
  postDialogueCommand(command: DialogueCommandDTO): Promise<DialogueCommandReceiptDTO>;
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
  setAlwaysOnTop: (enabled: boolean) => Promise<boolean>;
  getDebugTelemetry?: () => Promise<DebugTelemetryDTO>;
  clearDebugTelemetryLogs?: () => Promise<void>;
  onDebugTelemetry?: (listener: (telemetry: DebugTelemetryDTO) => void) => () => void;
  closeApp: () => Promise<void>;
}
