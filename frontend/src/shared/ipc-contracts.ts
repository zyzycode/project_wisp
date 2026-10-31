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

/** Target #8 contracts; bridge/handler/validation are wired together in implementation. */
export type MemoryStatusDTO =
  | { readonly mode: 'initializing' }
  | {
      readonly mode: 'persistent';
      readonly characterRestore: 'restored' | 'default' | 'invalid_snapshot' | 'unsupported_snapshot';
    }
  | {
      readonly mode: 'volatile';
      readonly reason: 'unavailable' | 'busy' | 'storage_full' | 'corrupt'
        | 'unsupported_version' | 'io_error';
    };

export interface ClearMemoryCommandDTO {
  readonly streamId: string;
  readonly requestId: string;
  /** Increasing per Brain stream, independently of dialogue and Body sequences. */
  readonly sequence: number;
}

export type ClearMemoryResultDTO =
  | { readonly requestId: string; readonly status: 'cleared' }
  | {
      readonly requestId: string;
      readonly status: 'failed';
      readonly reason: 'unavailable' | 'busy' | 'storage_full' | 'corrupt'
        | 'unsupported_version' | 'io_error' | 'stale';
    };

/** Read-only local presentation; no storage/source IDs or mutation capability. */
export interface MemoryFactsReadDTO { readonly streamId: string }
export type MemoryFactsResultDTO =
  | { readonly ok: true; readonly facts: readonly {
      readonly key: 'user.display_name' | 'user.preferred_address' | 'user.favorite_topic' | 'user.reply_style' | 'user.cursor_game';
      readonly value: string;
    }[] }
  | { readonly ok: false; readonly code: 'unavailable' | 'busy' | 'storage_full' | 'corrupt' | 'unsupported_version' | 'invalid_data' | 'conflict' | 'stale' | 'io_error' };

/** Explicit local event/joke cards; never a provider DTO. */
export interface MemoryCardContentDTO {
  readonly category: 'important_event' | 'shared_joke';
  readonly label: string;
  readonly text: string;
  readonly occurredOn: string | null;
}
export interface MemoryCardSourceDTO { readonly userMessageId: string; readonly assistantMessageId: string }
export interface MemoryCardDTO extends MemoryCardContentDTO {
  readonly id: string;
  readonly revision: number;
  readonly status: 'active' | 'withdrawn';
  readonly confirmedAt: string;
  readonly source: MemoryCardSourceDTO;
}
interface MemoryCardEnvelopeDTO {
  readonly streamId: string;
  readonly sequence: number;
  readonly commandId: string;
  readonly generation: number;
  readonly itemId: string;
  readonly expectedRevision: number;
}
export type MemoryCardCommandDTO = MemoryCardEnvelopeDTO & (
  | { readonly kind: 'confirm' | 'update'; readonly confirmed: true; readonly content: MemoryCardContentDTO; readonly source: MemoryCardSourceDTO }
  | { readonly kind: 'withdraw' | 'delete' }
);
export interface MemoryCardListCommandDTO { readonly streamId: string; readonly cursor: number | null; readonly limit: number }
export type MemoryCardFailureDTO = 'unavailable' | 'busy' | 'storage_full' | 'corrupt' | 'unsupported_version' | 'invalid_data' | 'conflict' | 'stale' | 'io_error';
export type MemoryCardResultDTO =
  | { readonly ok: true; readonly generation: number; readonly receipt: { readonly commandId: string; readonly itemId: string; readonly revision: number; readonly outcome: 'active' | 'withdrawn' | 'deleted' } }
  | { readonly ok: false; readonly generation: number; readonly code: MemoryCardFailureDTO };
export type MemoryCardListResultDTO =
  | { readonly ok: true; readonly generation: number; readonly items: readonly MemoryCardDTO[]; readonly nextCursor: number | null }
  | { readonly ok: false; readonly generation: number; readonly code: MemoryCardFailureDTO };

/** Explicit beverage preference commands; opaque offers resolve only in Main. */
export interface BeveragePreferenceRefDTO { readonly itemId: string; readonly revision: number }
export interface BeveragePreferenceDTO {
  readonly ref: BeveragePreferenceRefDTO;
  readonly source: MemoryCardSourceDTO;
  readonly evidenceQuote: string;
  readonly value: 'coffee' | 'tea';
  readonly provenance: 'model_proposal' | 'user_statement';
  readonly validity: 'hypothesis' | 'confirmed' | 'rejected';
  readonly manuallyCorrected: boolean;
  readonly status: 'active' | 'withdrawn';
}
export type BeveragePreferenceCommandDTO = {
  readonly streamId: string; readonly sequence: number; readonly generation: number; readonly commandId: string;
} & (
  | { readonly kind: 'save_hypothesis'; readonly itemId: string; readonly expected: null;
      readonly offerId: string; readonly consented: true }
  | { readonly kind: 'confirm' | 'correct'; readonly expected: BeveragePreferenceRefDTO;
      readonly value: 'coffee' | 'tea'; readonly confirmed: true }
  | { readonly kind: 'reject' | 'withdraw' | 'delete'; readonly expected: BeveragePreferenceRefDTO }
);
export interface BeveragePreferenceBridge {
  read(command: { readonly streamId: string }): Promise<InterestThreadResultDTO<BeveragePreferenceDTO | null>>;
  mutate(command: BeveragePreferenceCommandDTO): Promise<InterestThreadResultDTO<{
    readonly commandId: string; readonly ref: BeveragePreferenceRefDTO;
    readonly outcome: 'hypothesis' | 'confirmed' | 'rejected' | 'withdrawn' | 'deleted';
  }>>;
}

export interface InterestThreadRefDTO { readonly threadId: string; readonly revision: number }
export interface InterestThreadDTO {
  readonly ref: InterestThreadRefDTO;
  readonly state: 'unanswered' | 'answered' | 'closed';
  readonly text: string | null;
  readonly confirmedAt: string;
  readonly expiresAt: string;
  readonly attempted: boolean;
}
interface InterestThreadEnvelopeDTO {
  readonly streamId: string;
  readonly sequence: number;
  readonly generation: number;
  readonly commandId: string;
}
export type InterestThreadCommandDTO = InterestThreadEnvelopeDTO & (
  | { readonly kind: 'confirm'; readonly threadId: string; readonly expected: InterestThreadRefDTO | null;
      readonly conversationId: string; readonly source: MemoryCardSourceDTO; readonly text: string; readonly confirmed: true }
  | { readonly kind: 'close'; readonly expected: InterestThreadRefDTO; readonly reason: 'declined' | 'dismissed' }
  | { readonly kind: 'delete'; readonly expected: InterestThreadRefDTO }
);
export type InterestThreadResultDTO<T> =
  | { readonly ok: true; readonly generation: number; readonly value: T }
  | { readonly ok: false; readonly generation: number; readonly code: MemoryCardFailureDTO };
export interface InterestThreadApiBridge {
  read(command: { readonly streamId: string }): Promise<InterestThreadResultDTO<InterestThreadDTO | null>>;
  mutate(command: InterestThreadCommandDTO): Promise<InterestThreadResultDTO<{
    readonly commandId: string; readonly ref: InterestThreadRefDTO;
    readonly outcome: 'unanswered' | 'answered' | 'closed' | 'deleted';
  }>>;
}

export interface IgnoreMouseEventsDTO {
  ignore: boolean;
  forward?: boolean;
}

export interface SetAutonomyEnabledDTO {
  readonly enabled: boolean;
}

/** AUTO-A09 target command/state; wired atomically with Main/Preload/UI in #49. */
export interface SetQuietModeDTO {
  readonly enabled: boolean;
}

export interface AutonomyModeDTO {
  readonly quiet: boolean;
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
  | 'grab_edge'
  | 'jump_travel'
  | 'pull_up_edge'
  | 'sit_edge_settle'
  | 'sit_edge_sleep'
  | 'cursor_play'
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
  readonly episodeSequence: number;
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

/** Local game presentation; geometry and outcome decisions remain in Brain. */
export interface CursorGamePresentationDTO {
  readonly runId: string;
  readonly outcome: 'caught' | 'missed' | 'lost_target' | 'cancelled' | null;
  readonly speech: {
    readonly id: string;
    readonly text: string;
    readonly startedAtMs: number;
    readonly expiresAtMs: number;
  } | null;
}

/** Main-owned short autonomous line; it never changes the dialogue turn or activity. */
export interface AIInitiativeSpeechDTO {
  readonly id: string;
  readonly text: string;
  readonly startedAtMs: number;
  readonly expiresAtMs: number;
}

export interface BrainStateDTO {
  /** Main-owned external support capability; absence means unknown, not available. */
  readonly externalWindowSupport?: 'available' | 'initializing' | 'unavailable' | 'unsupported';
  /** Main monotonic sample; null means global source unavailable. Never a Body command. */
  readonly globalCursor?: { readonly globalPosition: { readonly x: number; readonly y: number }; readonly capturedAtMs: number } | null;
  readonly cursorGame: CursorGamePresentationDTO | null;
  /** Optional additive projection; absent/null both mean no autonomous AI speech. */
  readonly initiativeSpeech?: AIInitiativeSpeechDTO | null;
  readonly observationSpeech?: AIInitiativeSpeechDTO | null;
  readonly autonomy: AutonomyModeDTO;
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
  | { readonly type: 'send'; readonly text: string; readonly replyToInterestThread?: InterestThreadRefDTO; readonly requestBeverageProposal?: true }
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
  | QuietSupportAcknowledgementDTO
  | ChatMotionAcknowledgementDTO
  | { readonly phase: 'idle' }
  | { readonly phase: 'thinking'; readonly requestId: string }
  | {
      readonly phase: 'completed';
      readonly requestId: string;
      readonly replyText: string;
      readonly memorySource?: MemoryCardSourceDTO;
      readonly beverageOffer?: { readonly offerId: string; readonly value: 'coffee' | 'tea'; readonly evidenceQuote: string };
      /** Local reply target, only for a successful turn that used the confirmed topic. */
      readonly interestThread?: InterestThreadRefDTO;
      readonly outcome:
        | { readonly kind: 'success' }
        | { readonly kind: 'fallback'; readonly reason: DialogueFallbackReasonDTO };
    }
  | {
      readonly phase: 'error';
      readonly requestId: string;
      readonly message: string;
    };

/** Local deterministic support acknowledgement.
 * It has no provider result, fallback, confirmable memory source or topic claim.
 */
export interface QuietSupportAcknowledgementDTO {
  readonly memorySource?: never;
  readonly interestThread?: never;
  readonly phase: 'completed';
  readonly requestId: string;
  readonly replyText: string;
  readonly outcome: { readonly kind: 'local'; readonly reason: 'quiet_support' };
}

/** Local chat command acknowledgement; reply text describes authoritative execution facts. */
export interface ChatMotionAcknowledgementDTO {
  readonly memorySource?: never;
  readonly interestThread?: never;
  readonly phase: 'completed';
  readonly requestId: string;
  readonly replyText: string;
  readonly outcome: { readonly kind: 'local'; readonly reason: 'chat_motion' };
}

export interface DialoguePresentationDTO {
  readonly conversationId: string;
  /** False while outstanding/retired calls or admission policy prevent another send. */
  readonly canSubmit: boolean;
  /** Optional local admission notice, 1..240 UTF-16 units; only when canSubmit=false.
   * Separate from the character reply/history; no provider or transport internals.
   */
  readonly submissionMessage?: string;
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

export type SummaryFailureDTO = 'unavailable' | 'busy' | 'stale' | 'rate_limited' | 'failed' | 'conflict';
export interface SummaryPreviewDTO {
  readonly previewId: string;
  readonly expiresAt: number;
  readonly pairs: readonly { readonly userText: string; readonly assistantText: string }[];
}
export type SummaryResultDTO<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: SummaryFailureDTO };
export interface SummaryCommandDTO { readonly streamId: string }
export interface SummaryConfirmCommandDTO extends SummaryCommandDTO { readonly commandId: string; readonly previewId: string }
export interface SummaryApiBridge {
  preview(command: SummaryCommandDTO): Promise<SummaryResultDTO<SummaryPreviewDTO>>;
  confirm(command: SummaryConfirmCommandDTO): Promise<SummaryResultDTO<string>>;
  deleteSummary(command: SummaryCommandDTO): Promise<SummaryResultDTO<null>>;
}

/** Personal OpenAI setup only. Read projections never contain a key or key fragment. */
export interface AIConnectionStatusDTO {
  readonly mode: 'offline' | 'ready' | 'unavailable' | 'external';
  readonly hasSavedKey: boolean;
  readonly secureStorageAvailable: boolean;
  /** Ready means the local backend started; it does not validate the provider key. */
  readonly failure: 'secure_storage_unavailable' | 'storage_error' | 'runtime_unavailable'
    | 'startup_failed' | 'startup_timeout' | null;
}
export interface AIConnectionReadDTO { readonly streamId: string }
export type AIConnectionCommandDTO =
  | { readonly streamId: string; readonly kind: 'save'; readonly apiKey: string }
  | { readonly streamId: string; readonly kind: 'remove' };
export type AIConnectionResultDTO =
  | { readonly ok: true; readonly restartRequired: true }
  | { readonly ok: false; readonly code: 'invalid_input' | 'stale' | 'busy' | 'externally_managed'
      | 'secure_storage_unavailable' | 'storage_error' };
export interface AIConnectionApiBridge {
  read(command: AIConnectionReadDTO): Promise<AIConnectionStatusDTO>;
  /** Write-only credential ingress; success schedules a normal application restart. */
  configure(command: AIConnectionCommandDTO): Promise<AIConnectionResultDTO>;
}

export interface WispApiBridge {
  readonly voiceOutput?: import('./voice-output-contracts').VoiceOutputBridge;
  /** Optional capability until the local runtime and model are available. */
  readonly voiceInput?: VoiceInputApiBridge;
  /** Declared before implementation; the settings UI requires this capability. */
  readonly aiConnection?: AIConnectionApiBridge;
  readonly interestThread?: InterestThreadApiBridge;
  readonly beveragePreference?: BeveragePreferenceBridge;
  readonly observationCommand?: import('./observation-contracts').ObservationBridge['observationCommand'];
  readonly summary?: SummaryApiBridge;
  mutateMemoryCard(command: MemoryCardCommandDTO): Promise<MemoryCardResultDTO>;
  listMemoryCards(command: MemoryCardListCommandDTO): Promise<MemoryCardListResultDTO>;
  clearMemory(command: ClearMemoryCommandDTO): Promise<ClearMemoryResultDTO>;
  getMemoryStatus(): Promise<MemoryStatusDTO>;
  getRoutineStatus(): Promise<RoutineStatusDTO>;
  readMemoryFacts(command: MemoryFactsReadDTO): Promise<MemoryFactsResultDTO>;
  setQuietMode(command: SetQuietModeDTO): Promise<AutonomyModeDTO>;
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

export type VoiceInputErrorDTO =
  | 'unavailable' | 'not_ready' | 'busy' | 'cancelled' | 'timeout'
  | 'download_failed' | 'integrity_failed' | 'invalid_audio' | 'recognition_failed'
  | 'invalid_request' | 'stale_context' | 'text_too_long' | 'empty_transcript';

export type VoiceInputResultDTO<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: VoiceInputErrorDTO };

export interface VoiceModelStatusDTO {
  readonly state: 'not_installed' | 'downloading' | 'ready' | 'error';
  readonly downloadedBytes: number;
  readonly totalBytes: number;
}

export interface VoiceCaptureContextDTO {
  readonly streamId: string;
  readonly conversationId: string;
}

export interface VoiceTranscribeDTO extends VoiceCaptureContextDTO {
  readonly requestId: string;
  readonly language: 'ru' | 'en';
  /** Dense finite samples in [-1, 1], mono 16 kHz; 1..480000 items. */
  readonly samples: readonly number[];
}

/** Narrow invoke API; microphone capture itself remains browser user input. */
export interface VoiceInputApiBridge {
  readStatus(): Promise<VoiceInputResultDTO<VoiceModelStatusDTO>>;
  prepare(): Promise<VoiceInputResultDTO<VoiceModelStatusDTO>>;
  /** Explicit microphone mode for this dialogue context; independent of chat visibility. */
  enable(context: VoiceCaptureContextDTO): Promise<VoiceInputResultDTO<null>>;
  /** Revokes microphone permission mode and cancels every pending utterance. */
  disable(): Promise<VoiceInputResultDTO<null>>;
  /** Main revoked the mode; stop browser tracks and discard pending audio immediately. */
  onDisabled(listener: () => void): () => void;
  begin(context: VoiceCaptureContextDTO): Promise<VoiceInputResultDTO<{ readonly requestId: string }>>;
  transcribe(command: VoiceTranscribeDTO): Promise<VoiceInputResultDTO<{ readonly text: string }>>;
  cancel(command: { readonly requestId: string }): Promise<VoiceInputResultDTO<null>>;
}

/** Readonly projection; no observations, local identifiers or inferred schedule. */
export interface RoutineStatusDTO {
  readonly source: 'available' | 'unknown' | 'unsupported';
  readonly storage: 'initializing' | 'persistent' | 'degraded' | 'volatile';
  readonly lastAcknowledgedAt: string | null;
}
