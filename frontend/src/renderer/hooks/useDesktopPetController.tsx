import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CharacterTheme } from '../../domain/models/character-visuals';
import { DEFAULT_THEMES } from '../../domain/models/character-visuals';
import {
  createSystemAnimationIntent,
  type AnimationIntentKind,
} from '../../domain/animation/animation-intent';
import { createChatMessage } from '../render-engine/chat-message-presentation';
import type {
  PetPositionDTO,
  ScreenBoundsDTO,
  WispApiBridge,
} from '../../shared/ipc-contracts';
import {
  INTERACTION_REPLIES,
} from '../content/interaction-replies';
import { THOUGHT_FALLBACK, THOUGHTS } from '../content/thoughts';
import { requestCharacterSleepWake, toAnimationIntent } from '../pet-main-bridge';
import { useAnimationStateMachine } from './useAnimationStateMachine';
import { usePetBodyController } from './usePetBodyController';
import { usePetDialogue } from './usePetDialogue';
import { usePetDragController } from './usePetDragController';
import { useWindowOverlay } from './useWindowOverlay';
import { usePetDebugController } from './usePetDebugController';
import {
  animationStateToIntentKind,
  expressionToHint,
  localTerminalKind,
  synchronizeLocalAnimationState,
} from '../render-engine/pet-animation-presentation';
import { isCursorObservationCompatible } from '../body-ui-runtime';
import { applyLocalTerminalState } from '../render-engine/local-terminal-state';

const COMPACT_WINDOW_SIZE = { width: 280, height: 320 };

export interface UseDesktopPetControllerOptions {
  readonly bridge: WispApiBridge;
}

export function useDesktopPetController({ bridge }: UseDesktopPetControllerOptions) {
  const [position, setPosition] = useState<PetPositionDTO>({ x: 300, y: 300 });
  const [autoWanderEnabled, setAutoWanderEnabled] = useState(true);
  const [dragInteractionActive, setDragInteractionActive] = useState(false);
  const [localTerminalVisualKind, setLocalTerminalVisualKind] =
    useState<AnimationIntentKind | null>(null);
  const [currentTheme, setCurrentTheme] = useState<CharacterTheme>(
    DEFAULT_THEMES.cosmic ?? Object.values(DEFAULT_THEMES)[0]!
  );
  const [debugHudVisible, setDebugHudVisible] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true);
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
  const dialogue = usePetDialogue({ bridge, snapshot: bodySnapshot?.brain ?? null });
  const overlay = useWindowOverlay({
    bridge,
    controller: bodyController,
    forceInteractive:
      dragInteractionActive ||
      dialogue.chatOpen ||
      dialogue.currentMessage !== null ||
      debugHudVisible,
  });

  const {
    debugAnimationSelection, showAnchorPoint, manifestAnimations, setManifestAnimations,
    debugTelemetry, renderFps, inspectorBodyKey, inspectorFaceKey, previewLoop,
    selectPreviewBody, selectPreviewFace, clearPreview, setShowAnchorPoint,
    togglePreviewLoop, replayPreview, clearDebugLogs,
  } = usePetDebugController({
    bridge, menuOpen: overlay.menuOpen, setMenuOpen: overlay.setMenuOpen,
    debugHudVisible, setDebugHudVisible,
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
  const quietMode = brain?.autonomy.quiet ?? false;
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
      expressionHint: expressionToHint(expression),
    });
  }, [animState, expression, localTerminalVisualKind, visual]);

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

  const sendSleepWake = useCallback((action: 'sleep' | 'wake'): void => {
    void requestCharacterSleepWake(bridge, action).catch((error: unknown) => {
      console.error('Sleep/wake command failed:', error);
    });
  }, [bridge]);

  const handlePetClick = useCallback(() => {
    if (drag.consumeClickSuppression()) return;
    postInteraction('click');
  }, [drag, postInteraction]);

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

  const handleGazeDirectionChanged = useCallback((direction: 'left' | 'right' | 'up' | 'down' | 'neutral') => {
    const offsets = {
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      neutral: { x: 0, y: 0 },
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
    bodySnapshot,
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
    visualState: visual === null ? undefined : applyLocalTerminalState(visual,
      visual.visualIntent.episodeId === activeVisualEpisodeRef.current ? localTerminalVisualKind : null),
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
    gazeEnabled: !isSleeping && !isDragging,
    drag,
    handlePetClick,
    handlePetDoubleClick,
    handleContextMenu,
    handleResetPosition,
    autoWanderEnabled,
    quietMode,
    toggleQuietMode: () => { void bridge.setQuietMode({ enabled: !quietMode }).catch((error: unknown) => console.error('Quiet mode failed:', error)); },
    isSleeping,
    debugHudEnabled,
    debugHudVisible,
    setDebugHudVisible,
    isAlwaysOnTop,
    debugTelemetry,
    renderFps,
    inspectorBodyKey,
    setInspectorBodyKey: selectPreviewBody,
    inspectorFaceKey,
    setInspectorFaceKey: selectPreviewFace,
    setShowAnchorPoint,
    previewLoop,
    togglePreviewLoop,
    replayPreview,
    clearDebugLogs,
    sendInteraction: postInteraction,
    sendSleepWake,
    petFromMenu: () => {
      clearPreview();
      postInteraction('pet');
      dialogue.setCurrentMessage(createChatMessage('pet', INTERACTION_REPLIES.pet));
    },
    playFromMenu: () => {
      clearPreview();
      postInteraction('play');
      dialogue.setCurrentMessage(createChatMessage('pet', INTERACTION_REPLIES.play));
    },
    feedFromMenu: () => {
      clearPreview();
      postInteraction('feed');
      dialogue.setCurrentMessage(createChatMessage('pet', INTERACTION_REPLIES.feed));
    },
    toggleSleep: () => {
      clearPreview();
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
      clearPreview();
      postInteraction('think');
      const thought = THOUGHTS[Math.floor(Math.random() * THOUGHTS.length)] ?? THOUGHT_FALLBACK;
      dialogue.setCurrentMessage(createChatMessage('thought', thought));
    },
  };
}
