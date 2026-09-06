import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IAIProvider } from '../../application/ports/ai-provider.interface';
import type { CharacterTheme } from '../../domain/models/character-visuals';
import { DEFAULT_THEMES } from '../../domain/models/character-visuals';
import type {
  AnimationEvent,
  AnyAnimationState,
  TerminalAnimationState,
} from '../../domain/animation/animation-state-machine';
import {
  createSystemAnimationIntent,
  type AnimationExpressionHint,
  type AnimationIntentKind,
} from '../../domain/animation/animation-intent';
import { createChatMessage } from '../../domain/chat/chat-message';
import type {
  DebugTelemetryDTO,
  PetPositionDTO,
  ScreenBoundsDTO,
  WispApiBridge,
} from '../../shared/ipc-contracts';
import type {
  DebugAnimationSelection,
  ManifestAnimationRegistry,
} from '../components/Character/CharacterRenderer';
import {
  CLICK_REPLIES,
  CLICK_REPLY_FALLBACK,
  FACE_PREVIEW_DEFAULT_REPLY,
  FACE_PREVIEW_FALLBACK_PREFIX,
  FACE_PREVIEW_REPLIES,
  INTERACTION_REPLIES,
} from '../content/interaction-replies';
import { THOUGHT_FALLBACK, THOUGHTS } from '../content/thoughts';
import { requestCharacterSleepWake, toAnimationIntent } from '../pet-main-bridge';
import { useAnimationStateMachine } from './useAnimationStateMachine';
import { usePetBodyController } from './usePetBodyController';
import { usePetDialogue } from './usePetDialogue';
import { usePetDragController } from './usePetDragController';
import { useWindowOverlay } from './useWindowOverlay';
import { isCursorObservationCompatible } from '../body-ui-runtime';

const COMPACT_WINDOW_SIZE = { width: 280, height: 320 };

const EMPTY_DEBUG_TELEMETRY: DebugTelemetryDTO = {
  character: {
    needs: { energy: 0, attention: 0, play: 0, comfort: 0 },
    relationship: { friendship: 0, love: 0, loveUnlocked: false },
    synthesizedTone: 'neutral',
    lastUpdated: 0,
  },
  logs: [],
};

export interface UseDesktopPetControllerOptions {
  readonly aiProvider: IAIProvider;
  readonly bridge: WispApiBridge;
}

export function useDesktopPetController({ aiProvider, bridge }: UseDesktopPetControllerOptions) {
  const [position, setPosition] = useState<PetPositionDTO>({ x: 300, y: 300 });
  const [autoWanderEnabled, setAutoWanderEnabled] = useState(true);
  const [dragInteractionActive, setDragInteractionActive] = useState(false);
  const [localTerminalVisualKind, setLocalTerminalVisualKind] =
    useState<AnimationIntentKind | null>(null);
  const [customFace, setCustomFace] = useState<AnimationExpressionHint | null>(null);
  const [currentTheme, setCurrentTheme] = useState<CharacterTheme>(
    DEFAULT_THEMES.cosmic ?? Object.values(DEFAULT_THEMES)[0]!
  );
  const [scale, setScale] = useState(1);
  const [debugHudVisible, setDebugHudVisible] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true);
  const [manifestAnimations, setManifestAnimations] = useState<ManifestAnimationRegistry>({
    bodyKeys: [],
    faceKeys: [],
  });
  const [inspectorBodyKey, setInspectorBodyKey] = useState<string | null>(null);
  const [inspectorFaceKey, setInspectorFaceKey] = useState<string | null>(null);
  const [showAnchorPoint, setShowAnchorPoint] = useState(false);
  const [debugTelemetry, setDebugTelemetry] = useState(EMPTY_DEBUG_TELEMETRY);
  const [renderFps, setRenderFps] = useState(0);
  const activeVisualEpisodeRef = useRef<string | null>(null);
  const activeVisualKindRef = useRef<AnimationIntentKind>('idle_blink');
  const debugHudEnabled = bridge.debugEnabled;

  const {
    state: animState,
    expression,
    dispatch: dispatchAnim,
    completeCurrentState: completeCurrentAnimationState,
    synchronizeTerminalState: synchronizeTerminalAnimationState,
  } = useAnimationStateMachine('idle');
  const {
    controller: bodyController,
    snapshot: bodySnapshot,
    postInteraction,
    postCursorObservation,
  } = usePetBodyController(bridge);
  const dialogue = usePetDialogue({ aiProvider, animState, dispatchAnim });
  const overlay = useWindowOverlay({
    bridge,
    controller: bodyController,
    forceInteractive:
      dragInteractionActive ||
      dialogue.chatOpen ||
      dialogue.currentMessage !== null ||
      debugHudVisible,
  });

  const handleDragStarted = useCallback(() => {
    setDragInteractionActive(true);
    overlay.setMenuOpen(false);
    dialogue.closeChat();
  }, [dialogue.closeChat, overlay.setMenuOpen]);
  const handleDragEnded = useCallback(() => setDragInteractionActive(false), []);
  const drag = usePetDragController({
    controller: bodyController,
    onDragStarted: handleDragStarted,
    onDragEnded: handleDragEnded,
  });

  const brain = bodySnapshot?.brain ?? null;
  const visual = bodySnapshot?.visual ?? null;
  const isWandering = brain?.visualIntent.kind === 'walk';
  const isDragging = drag.isDragging || brain?.motion.phase === 'dragged';

  useEffect(() => {
    if (brain === null || visual === null) return;
    setPosition(brain.motion.rootScreenPosition);
    if (brain.visualIntent.episodeId === activeVisualEpisodeRef.current) return;
    activeVisualEpisodeRef.current = brain.visualIntent.episodeId;
    activeVisualKindRef.current = brain.visualIntent.kind;
    setLocalTerminalVisualKind(null);
    synchronizeLocalAnimationState(
      brain.visualIntent.kind,
      dispatchAnim,
      synchronizeTerminalAnimationState
    );
  }, [brain, dispatchAnim, synchronizeTerminalAnimationState]);

  const characterAnimationIntent = useMemo(() => {
    if (visual !== null) {
      if (localTerminalVisualKind === null) return toAnimationIntent(visual.visualIntent);
      return createSystemAnimationIntent(
        localTerminalVisualKind,
        visual.visualIntent.emotionalTone
      );
    }
    return createSystemAnimationIntent(animationStateToIntentKind(animState), 'neutral', {
      expressionHint: customFace ?? expressionToHint(expression),
    });
  }, [animState, customFace, expression, localTerminalVisualKind, visual]);

  const debugAnimationSelection = useMemo<DebugAnimationSelection | undefined>(() => {
    if (inspectorBodyKey === null) return undefined;
    return {
      bodyKey: inspectorBodyKey,
      ...(inspectorFaceKey === null ? {} : { faceKey: inspectorFaceKey }),
    };
  }, [inspectorBodyKey, inspectorFaceKey]);

  const handleAnimationCompleted = useCallback((
    _event: unknown,
    completedVisualEpisodeId: string | undefined
  ): void => {
    if (completedVisualEpisodeId !== activeVisualEpisodeRef.current) return;
    completeCurrentAnimationState();
    const terminalKind = localTerminalKind(activeVisualKindRef.current);
    if (terminalKind !== null) setLocalTerminalVisualKind(terminalKind);
  }, [completeCurrentAnimationState]);

  const handleAnimationRejected = useCallback((rejectedVisualEpisodeId: string | undefined): void => {
    if (rejectedVisualEpisodeId === activeVisualEpisodeRef.current) {
      setLocalTerminalVisualKind('idle_blink');
    }
  }, []);

  useEffect(() => {
    if (!debugHudEnabled || (!debugHudVisible && !overlay.menuOpen)) return undefined;
    const getDebugTelemetry = bridge.getDebugTelemetry;
    const onDebugTelemetry = bridge.onDebugTelemetry;
    if (getDebugTelemetry === undefined || onDebugTelemetry === undefined) return undefined;
    let active = true;
    const refreshTelemetry = (): void => {
      void getDebugTelemetry()
        .then((telemetry) => {
          if (active) setDebugTelemetry(telemetry);
        })
        .catch(() => undefined);
    };
    refreshTelemetry();
    const unsubscribe = onDebugTelemetry((telemetry) => {
      if (active) setDebugTelemetry(telemetry);
    });
    const intervalId = window.setInterval(refreshTelemetry, 1_000);
    return (): void => {
      active = false;
      window.clearInterval(intervalId);
      unsubscribe();
    };
  }, [bridge, debugHudEnabled, debugHudVisible, overlay.menuOpen]);

  useEffect(() => {
    if (!debugHudEnabled) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setDebugHudVisible((visible) => !visible);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return (): void => window.removeEventListener('keydown', handleKeyDown);
  }, [debugHudEnabled]);

  useEffect(() => {
    if (!debugHudVisible && !overlay.menuOpen) return undefined;
    let frameId = 0;
    let frames = 0;
    let sampleStartedAt = performance.now();
    const sample = (now: number): void => {
      frames += 1;
      const elapsedMs = now - sampleStartedAt;
      if (elapsedMs >= 500) {
        setRenderFps(Math.round((frames * 1_000) / elapsedMs));
        frames = 0;
        sampleStartedAt = now;
      }
      frameId = window.requestAnimationFrame(sample);
    };
    frameId = window.requestAnimationFrame(sample);
    return (): void => window.cancelAnimationFrame(frameId);
  }, [debugHudVisible, overlay.menuOpen]);

  const sendSleepWake = useCallback((action: 'sleep' | 'wake'): void => {
    void requestCharacterSleepWake(bridge, action).catch((error: unknown) => {
      console.error('Sleep/wake command failed:', error);
    });
  }, [bridge]);

  const handlePetClick = useCallback(() => {
    if (drag.consumeClickSuppression()) return;
    postInteraction('click');
    const text = animState === 'sleep'
      ? INTERACTION_REPLIES.wakeFromClick
      : CLICK_REPLIES[Math.floor(Math.random() * CLICK_REPLIES.length)] ?? CLICK_REPLY_FALLBACK;
    dialogue.setCurrentMessage(createChatMessage('pet', text));
  }, [animState, dialogue.setCurrentMessage, drag, postInteraction]);

  const handlePetDoubleClick = useCallback(() => {
    if (drag.consumeClickSuppression()) return;
    postInteraction('double_click', 1);
    dialogue.setChatOpen(true);
    overlay.setMenuOpen(false);
  }, [dialogue.setChatOpen, drag, overlay.setMenuOpen, postInteraction]);

  const handleContextMenu = useCallback((event: React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    postInteraction('right_click');
    dialogue.closeChat();
    overlay.setMenuOpen(true);
  }, [dialogue.closeChat, overlay.setMenuOpen, postInteraction]);

  const handleResetPosition = useCallback(() => {
    const resetToCenter = (bounds: ScreenBoundsDTO): void => {
      const centeredPosition = {
        x: Math.round(bounds.x + (bounds.width - COMPACT_WINDOW_SIZE.width) / 2),
        y: Math.round(bounds.y + (bounds.height - COMPACT_WINDOW_SIZE.height) / 2),
      };
      const update = bridge.updatePosition;
      if (update === undefined) {
        setPosition(centeredPosition);
        overlay.setMenuOpen(false);
        return;
      }
      void update(centeredPosition)
        .then((nextPosition) => {
          setPosition(nextPosition);
          overlay.setMenuOpen(false);
        })
        .catch((error: unknown) => console.error('Failed to reset position:', error));
    };
    void bridge.getEnvironmentSnapshot()
      .then((snapshot) => resetToCenter(snapshot.screenBounds))
      .catch((error: unknown) => console.error('Failed to get environment snapshot:', error));
  }, [bridge, overlay.setMenuOpen]);

  const handleSelectFace = useCallback((face: AnimationExpressionHint | null) => {
    setCustomFace(face);
    const text = face
      ? FACE_PREVIEW_REPLIES[face] ?? `${FACE_PREVIEW_FALLBACK_PREFIX}${face}`
      : FACE_PREVIEW_DEFAULT_REPLY;
    dialogue.setCurrentMessage(createChatMessage('thought', text));
  }, [dialogue.setCurrentMessage]);

  const handlePlayAnimation = useCallback((event: AnimationEvent): void => {
    if (event === 'START_SLEEP') {
      sendSleepWake('sleep');
      dialogue.setCurrentMessage(createChatMessage('thought', INTERACTION_REPLIES.sleep));
    } else if (event === 'WAKE_UP') {
      sendSleepWake('wake');
      dialogue.setCurrentMessage(createChatMessage('pet', INTERACTION_REPLIES.wake));
    } else if (event === 'PET' || event === 'REACT_HAPPY') {
      postInteraction('pet');
      dispatchAnim('PET', true, true);
      dialogue.setCurrentMessage(createChatMessage('pet', INTERACTION_REPLIES.pet));
    } else if (event === 'THINK') {
      postInteraction('think');
      dispatchAnim('THINK', true, true);
      dialogue.setCurrentMessage(createChatMessage('thought', INTERACTION_REPLIES.think));
    } else if (event === 'SPOOK' || event === 'REACT_CONFUSED') {
      postInteraction('click', 1);
      dispatchAnim('SPOOK', true, true);
      dialogue.setCurrentMessage(createChatMessage('pet', INTERACTION_REPLIES.spook));
    } else if (event === 'LAND' || event === 'SETTLE') {
      dispatchAnim(event, true, false);
    } else {
      dispatchAnim(event, true, true);
    }
  }, [dialogue.setCurrentMessage, dispatchAnim, postInteraction, sendSleepWake]);

  const handleGazeDirectionChanged = useCallback((direction: 'left' | 'right' | 'up' | 'down') => {
    const offsets = {
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
    } as const;
    bodyController.setPupilOffset(offsets[direction]);
  }, [bodyController]);

  const isSleeping = brain?.visualIntent.kind === 'sleep_start' || brain?.visualIntent.kind === 'sleep_loop';
  const cursorObservationEnabled = isCursorObservationCompatible({
    autonomyEnabled: autoWanderEnabled,
    menuOpen: overlay.menuOpen,
    dragging: isDragging,
    motionPhase: brain?.motion.phase,
    activityId: brain === null ? undefined : brain.activity?.activityId ?? null,
    visualKind: brain?.visualIntent.kind,
  });

  return {
    position,
    isDragging,
    isWandering,
    menuOpen: overlay.menuOpen,
    setMenuOpen: overlay.setMenuOpen,
    dialogue,
    animState,
    expression,
    characterAnimationIntent,
    currentTheme,
    setCurrentTheme,
    scale,
    setScale,
    visualState: visual ?? undefined,
    flipX: visual?.reflex.transform.flipX ?? false,
    scaleX: visual?.reflex.transform.scaleX ?? 1,
    scaleY: visual?.reflex.transform.scaleY ?? 1,
    tiltDeg: visual?.reflex.transform.rotationDeg ?? 0,
    visualEpisodeId: visual?.visualIntent.episodeId,
    visualAgeMs: visual?.visualAgeMs ?? 0,
    debugAnimationSelection,
    showAnchorPoint,
    manifestAnimations,
    setManifestAnimations,
    handleAnimationCompleted,
    handleAnimationRejected,
    handleGazeDirectionChanged,
    handleCursorObserved: postCursorObservation,
    cursorObservationEnabled,
    drag,
    handlePetClick,
    handlePetDoubleClick,
    handleContextMenu,
    handleResetPosition,
    handleSelectFace,
    handlePlayAnimation,
    autoWanderEnabled,
    isSleeping,
    debugHudEnabled,
    debugHudVisible,
    setDebugHudVisible,
    isAlwaysOnTop,
    debugTelemetry,
    renderFps,
    customFace,
    inspectorBodyKey,
    setInspectorBodyKey,
    inspectorFaceKey,
    setInspectorFaceKey,
    setShowAnchorPoint,
    clearDebugLogs: () => {
      if (bridge.clearDebugTelemetryLogs !== undefined) void bridge.clearDebugTelemetryLogs();
    },
    sendInteraction: postInteraction,
    sendSleepWake,
    petFromMenu: () => {
      postInteraction('pet');
      dialogue.setCurrentMessage(createChatMessage('pet', INTERACTION_REPLIES.pet));
    },
    playFromMenu: () => {
      postInteraction('play');
      dialogue.setCurrentMessage(createChatMessage('pet', INTERACTION_REPLIES.play));
    },
    feedFromMenu: () => {
      postInteraction('feed');
      dialogue.setCurrentMessage(createChatMessage('pet', INTERACTION_REPLIES.feed));
    },
    toggleSleep: () => {
      if (isSleeping) {
        sendSleepWake('wake');
        dialogue.setCurrentMessage(createChatMessage('pet', INTERACTION_REPLIES.wake));
      } else {
        sendSleepWake('sleep');
        dialogue.setCurrentMessage(createChatMessage('thought', INTERACTION_REPLIES.sleep));
      }
    },
    toggleChat: () => {
      dialogue.setChatOpen((open) => !open);
      overlay.setMenuOpen(false);
    },
    toggleWander: () => {
      const nextValue = !autoWanderEnabled;
      setAutoWanderEnabled(nextValue);
      void bridge.setAutonomyEnabled?.({ enabled: nextValue }).catch((error: unknown) => {
        console.error('Failed to toggle autonomy:', error);
      });
    },
    toggleAlwaysOnTop: () => {
      const nextValue = !isAlwaysOnTop;
      void bridge.setAlwaysOnTop(nextValue)
        .then(setIsAlwaysOnTop)
        .catch((error: unknown) => console.error('Failed to toggle always-on-top:', error));
    },
    closeApp: () => void bridge.closeApp(),
    showRandomThought: () => {
      postInteraction('think');
      overlay.setMenuOpen(false);
      const thought = THOUGHTS[Math.floor(Math.random() * THOUGHTS.length)] ?? THOUGHT_FALLBACK;
      dialogue.setCurrentMessage(createChatMessage('thought', thought));
    },
  };
}

function animationStateToIntentKind(state: AnyAnimationState): AnimationIntentKind {
  const mapping: Partial<Record<AnyAnimationState, AnimationIntentKind>> = {
    float: 'walk', dragged: 'dragged', falling: 'fall', fall: 'fall', landing: 'land',
    land: 'land', sleep: 'sleep_loop', sleep_loop: 'sleep_loop', sleep_start: 'sleep_start',
    wake_up: 'wake_up', happy: 'happy_reaction', surprised: 'confused_reaction',
    thinking: 'thinking_loop', spook: 'spook', wave: 'wave', celebrate: 'celebrate',
    bored: 'bored', settle: 'settle', sit: 'sit', stand_up: 'stand_up', lie_down: 'lie_down',
    get_up: 'get_up', run: 'run', jump: 'jump', crawl: 'crawl', climb_wall: 'climb_wall',
    hang_ceiling: 'hang_ceiling', idle: 'idle_blink',
  };
  return mapping[state] ?? 'idle_blink';
}

function localTerminalKind(kind: AnimationIntentKind): AnimationIntentKind | null {
  if (kind === 'sleep_start') return 'sleep_loop';
  if (kind === 'land' || kind === 'crash_landing') return 'settle';
  if (['wake_up', 'happy_reaction', 'confused_reaction', 'talking', 'spook'].includes(kind)) {
    return 'idle_blink';
  }
  return null;
}

function synchronizeLocalAnimationState(
  kind: AnimationIntentKind,
  dispatch: (event: AnimationEvent, force?: boolean, loop?: boolean) => boolean,
  synchronizeTerminal: (state: TerminalAnimationState) => boolean
): void {
  if (kind === 'idle_blink' || kind === 'settle' || kind === 'sleep_loop') {
    synchronizeTerminal(kind === 'idle_blink' ? 'idle' : kind);
    return;
  }
  const events: Partial<Record<AnimationIntentKind, AnimationEvent>> = {
    walk: 'START_FLOAT', sleep_start: 'START_SLEEP', wake_up: 'WAKE_UP',
    happy_reaction: 'REACT_HAPPY', confused_reaction: 'REACT_CONFUSED',
    thinking_loop: 'THINK', bored: 'BORED', wave: 'WAVE', celebrate: 'CELEBRATE',
    spook: 'SPOOK', dragged: 'START_DRAG', land: 'LAND', sit: 'SIT', sit_edge: 'SIT',
    stand_up: 'STAND_UP', lie_down: 'LIE_DOWN', get_up: 'GET_UP', run: 'RUN',
    jump: 'JUMP', fall: 'FALL', crawl: 'CRAWL', climb_wall: 'CLIMB_WALL',
    hang_ceiling: 'HANG_CEILING',
  };
  const event = events[kind];
  if (event !== undefined) dispatch(event, true, kind.endsWith('_loop'));
}

function expressionToHint(expression: string): AnimationExpressionHint {
  if (expression === 'happy') return 'happy';
  if (expression === 'sleepy') return 'sleepy';
  if (expression === 'surprised' || expression === 'flying') return 'surprised';
  if (expression === 'curious') return 'curious';
  return 'idle';
}
