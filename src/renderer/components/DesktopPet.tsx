import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type {
  BrainVisualIntentDTO,
  CharacterInteractionDTO,
  DebugTelemetryDTO,
  PetPositionDTO,
  ScreenBoundsDTO,
  SleepWakeCommandDTO,
} from '../../shared/ipc-contracts';
import type { CharacterExpression, CharacterTheme } from '../../domain/models/character-visuals';
import { DEFAULT_THEMES } from '../../domain/models/character-visuals';
import type { ChatMessage } from '../../domain/chat/chat-message';
import { createChatMessage } from '../../domain/chat/chat-message';
import type { IAIProvider } from '../../application/ports/ai-provider.interface';
import { MockAIProvider } from '../../infrastructure/ai/mock-ai-provider';
import {
  CharacterRenderer,
  type DebugAnimationSelection,
  type ManifestAnimationRegistry,
} from './Character/CharacterRenderer';
import { ContextMenu } from './Interaction/ContextMenu';
import { SpeechBubble } from './Chat/SpeechBubble';
import { ChatInput } from './Chat/ChatInput';
import { useAnimationStateMachine } from '../hooks/useAnimationStateMachine';
import { useDialogueLoop } from '../hooks/useDialogueLoop';
import {
  CLICK_REPLIES,
  CLICK_REPLY_FALLBACK,
  FACE_PREVIEW_DEFAULT_REPLY,
  FACE_PREVIEW_FALLBACK_PREFIX,
  FACE_PREVIEW_REPLIES,
  INTERACTION_REPLIES,
} from '../content/interaction-replies';
import { THOUGHT_FALLBACK, THOUGHTS } from '../content/thoughts';
import {
  createSystemAnimationIntent,
  type AnimationExpressionHint,
  type AnimationIntentKind,
} from '../../domain/animation/animation-intent';
import type {
  AnimationEvent,
  AnyAnimationState,
  TerminalAnimationState,
} from '../../domain/animation/animation-state-machine';
import { DebugHUD } from './Debug';
import {
  BrainStateRevisionGate,
  PetDragController,
  requestCharacterSleepWake,
  subscribeToBrainState,
  toAnimationIntent,
} from '../pet-main-bridge';

const COMPACT_WINDOW_SIZE = { width: 280, height: 320 };

const DEFAULT_MOCK_AI_PROVIDER = new MockAIProvider({ simulatedLatencyMs: 300 });
const EMPTY_DEBUG_TELEMETRY: DebugTelemetryDTO = {
  character: {
    needs: { energy: 0, attention: 0, play: 0, comfort: 0 },
    relationship: { friendship: 0, love: 0, loveUnlocked: false },
    synthesizedTone: 'neutral',
    lastUpdated: 0,
  },
  logs: [],
};

export interface DesktopPetProps {
  aiProvider?: IAIProvider;
}

export const DesktopPet: React.FC<DesktopPetProps> = ({
  aiProvider = DEFAULT_MOCK_AI_PROVIDER,
}) => {
  const [position, setPosition] = useState<PetPositionDTO>({ x: 300, y: 300 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [tiltDeg, setTiltDeg] = useState<number>(0);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [chatOpen, setChatOpen] = useState<boolean>(false);
  const [currentMessage, setCurrentMessage] = useState<ChatMessage | null>(null);
  const [autoWanderEnabled, setAutoWanderEnabled] = useState<boolean>(true);
  const [isWandering, setIsWandering] = useState<boolean>(false);
  const [brainVisualIntent, setBrainVisualIntent] = useState<BrainVisualIntentDTO | null>(null);
  const [visualEpisodeId, setVisualEpisodeId] = useState<string | undefined>();
  const [visualAgeMs, setVisualAgeMs] = useState(0);
  const [localTerminalVisualKind, setLocalTerminalVisualKind] =
    useState<AnimationIntentKind | null>(null);
  const [flipX, setFlipX] = useState<boolean>(false);
  const [customFace, setCustomFace] = useState<AnimationExpressionHint | null>(null);
  const [currentTheme, setCurrentTheme] = useState<CharacterTheme>(
    DEFAULT_THEMES.cosmic ?? Object.values(DEFAULT_THEMES)[0]!
  );
  const [scale, setScale] = useState<number>(1.0);
  const [debugHudVisible, setDebugHudVisible] = useState<boolean>(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState<boolean>(true);
  const [manifestAnimations, setManifestAnimations] = useState<ManifestAnimationRegistry>(
    {
      bodyKeys: [],
      faceKeys: [],
    }
  );
  const [inspectorBodyKey, setInspectorBodyKey] = useState<string | null>(null);
  const [inspectorFaceKey, setInspectorFaceKey] = useState<string | null>(null);
  const [showAnchorPoint, setShowAnchorPoint] = useState<boolean>(false);
  const [debugTelemetry, setDebugTelemetry] =
    useState<DebugTelemetryDTO>(EMPTY_DEBUG_TELEMETRY);
  const [renderFps, setRenderFps] = useState<number>(0);
  const debugHudEnabled = window.wispAPI?.debugEnabled ?? false;

  const sendCharacterInteraction = useCallback(
    (interaction: CharacterInteractionDTO): void => {
      void window.wispAPI
        ?.interactWithCharacter(interaction)
        ?.catch((err) => console.error('Character interaction failed:', err));
    },
    []
  );

  const sendSleepWakeCommand = useCallback(
    (command: SleepWakeCommandDTO): void => {
      if (!window.wispAPI) return;
      void requestCharacterSleepWake(window.wispAPI, command.action).catch((err: unknown) =>
        console.error('Sleep/wake command failed:', err)
      );
    },
    []
  );

  // Animation State Machine Hook (FSM)
  const {
    state: animState,
    expression,
    dispatch: dispatchAnim,
    completeCurrentState: completeCurrentAnimationState,
    synchronizeTerminalState: synchronizeTerminalAnimationState,
  } = useAnimationStateMachine('idle');

  // Drag & Presentation State handling via Preload IPC bridge
  const dragControllerRef = useRef<PetDragController | null>(null);
  if (!dragControllerRef.current && Boolean(window.wispAPI)) {
    dragControllerRef.current = new PetDragController(window.wispAPI);
  }

  const isMouseDownRef = useRef(false);
  const dragStartPosRef = useRef<{ screenX: number; screenY: number }>({ screenX: 0, screenY: 0 });
  const isDraggingRef = useRef(false);
  const hasMovedRef = useRef(false);
  const activeVisualEpisodeRef = useRef<string | null>(null);
  const activeVisualKindRef = useRef<AnimationIntentKind>('idle_blink');

  // Subscribe to the Main-owned Brain stream (semantic state and authoritative motion).
  useEffect(() => {
    if (!window.wispAPI?.onBrainState) return undefined;
    const revisionGate = new BrainStateRevisionGate();
    const unsubscribe = subscribeToBrainState(window.wispAPI, (payload) => {
      const state = revisionGate.accept(payload);
      if (state === null) return;
      setPosition(state.motion.rootScreenPosition);
      const isNowDragging = state.motion.phase === 'dragged';
      setIsDragging(isNowDragging);
      const isNowWandering = state.visualIntent.kind === 'walk';
      setIsWandering(isNowWandering);
      if (isNowWandering && state.motion.velocityPxPerSec.x !== 0) {
        setFlipX(state.motion.velocityPxPerSec.x > 0);
      }

      if (state.visualIntent.episodeId !== activeVisualEpisodeRef.current) {
        activeVisualEpisodeRef.current = state.visualIntent.episodeId;
        activeVisualKindRef.current = state.visualIntent.kind;
        setVisualEpisodeId(state.visualIntent.episodeId);
        setVisualAgeMs(state.sampledAtMs - state.visualIntent.episodeStartedAtMs);
        setBrainVisualIntent(state.visualIntent);
        setLocalTerminalVisualKind(null);
        synchronizeLocalAnimationState(
          state.visualIntent.kind,
          dispatchAnim,
          synchronizeTerminalAnimationState
        );
      }

      const vx = state.motion.velocityPxPerSec.x;
      setTiltDeg(Math.max(-25, Math.min(25, vx * 0.02)));
    });
    return unsubscribe;
  }, [dispatchAnim, synchronizeTerminalAnimationState]);

  // Pointer drag event handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left click only for dragging / gestures
    isMouseDownRef.current = true;
    hasMovedRef.current = false;
    isDraggingRef.current = false;
    dragStartPosRef.current = { screenX: e.screenX, screenY: e.screenY };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isMouseDownRef.current) return;
      const deltaX = e.screenX - dragStartPosRef.current.screenX;
      const deltaY = e.screenY - dragStartPosRef.current.screenY;

      // Threshold to detect start of drag
      if (
        !isDraggingRef.current &&
        (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4)
      ) {
        isDraggingRef.current = true;
        hasMovedRef.current = true;
        setMenuOpen(false);
        setChatOpen(false);
        dragControllerRef.current?.begin(1, { x: e.screenX, y: e.screenY });
      }

      if (isDraggingRef.current) {
        dragControllerRef.current?.move({ x: e.screenX, y: e.screenY });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!isMouseDownRef.current) return;
      isMouseDownRef.current = false;

      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        dragControllerRef.current?.release({ x: e.screenX, y: e.screenY });
        setTiltDeg(0);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [sendCharacterInteraction]);

  // Notify Electron main process when menu expands or collapses and synchronize position
  useEffect(() => {
    if (window.wispAPI?.setMenuExpanded) {
      window.wispAPI
        .setMenuExpanded(menuOpen)
        .then((newPos) => {
          if (newPos) {
            setPosition(newPos);
          }
        })
        .catch((err) =>
          console.error('Failed to update menu expanded state:', err)
        );
    }
  }, [menuOpen]);

  const characterAnimationIntent = useMemo(() => {
    if (brainVisualIntent !== null) {
      if (localTerminalVisualKind === null) return toAnimationIntent(brainVisualIntent);
      return createSystemAnimationIntent(
        localTerminalVisualKind,
        brainVisualIntent.emotionalTone
      );
    }
    const kind = isWandering ? 'walk' : animationStateToIntentKind(animState);
    const defaultHint = expressionToHint(expression);
    const expressionHint = customFace ?? defaultHint;
    return createSystemAnimationIntent(kind, 'neutral', {
      expressionHint,
    });
  }, [animState, brainVisualIntent, expression, isWandering, customFace, localTerminalVisualKind]);

  const debugAnimationSelection = useMemo<
    DebugAnimationSelection | undefined
  >(() => {
    if (inspectorBodyKey === null) return undefined;
    return {
      bodyKey: inspectorBodyKey,
      ...(inspectorFaceKey === null ? {} : { faceKey: inspectorFaceKey }),
    };
  }, [inspectorBodyKey, inspectorFaceKey]);

  const handleManifestAnimationsLoaded = useCallback(
    (registry: ManifestAnimationRegistry): void => {
      setManifestAnimations(registry);
    },
    []
  );

  const handleAnimationCompleted = useCallback((
    _event: unknown,
    completedVisualEpisodeId: string | undefined
  ): void => {
    if (completedVisualEpisodeId !== activeVisualEpisodeRef.current) return;
    completeCurrentAnimationState();
    const terminalKind = localTerminalKind(activeVisualKindRef.current);
    if (terminalKind !== null) setLocalTerminalVisualKind(terminalKind);
  }, [completeCurrentAnimationState]);

  const handleAnimationRejected = useCallback((
    rejectedVisualEpisodeId: string | undefined
  ): void => {
    if (rejectedVisualEpisodeId !== activeVisualEpisodeRef.current) return;
    setLocalTerminalVisualKind('idle_blink');
  }, []);

  useEffect(() => {
    if (!debugHudEnabled || (!debugHudVisible && !menuOpen)) return undefined;
    const getDebugTelemetry = window.wispAPI?.getDebugTelemetry;
    const onDebugTelemetry = window.wispAPI?.onDebugTelemetry;
    if (getDebugTelemetry === undefined || onDebugTelemetry === undefined)
      return undefined;
    let active = true;
    const refreshTelemetry = (): void => {
      void getDebugTelemetry()
        .then((telemetry) => {
          if (active) setDebugTelemetry(telemetry);
        })
        .catch(() => undefined);
    };
    refreshTelemetry();
    const unsubscribe = onDebugTelemetry((telemetry) =>
      setDebugTelemetry(telemetry)
    );
    const intervalId = window.setInterval(refreshTelemetry, 1000);
    return (): void => {
      active = false;
      window.clearInterval(intervalId);
      unsubscribe();
    };
  }, [debugHudEnabled, debugHudVisible, menuOpen]);

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
    if (!debugHudVisible && !menuOpen) return undefined;
    let frameId = 0;
    let frames = 0;
    let sampleStartedAt = performance.now();
    const sample = (now: number): void => {
      frames += 1;
      const elapsedMs = now - sampleStartedAt;
      if (elapsedMs >= 500) {
        setRenderFps(Math.round((frames * 1000) / elapsedMs));
        frames = 0;
        sampleStartedAt = now;
      }
      frameId = requestAnimationFrame(sample);
    };
    frameId = requestAnimationFrame(sample);
    return (): void => cancelAnimationFrame(frameId);
  }, [debugHudVisible, menuOpen]);

  // Dialogue Loop Hook (AI Provider -> BehaviorIntent -> SpeechBubble & FSM)
  const { handleSendMessage: handleUserSendMessage } = useDialogueLoop({
    aiProvider,
    animState,
    setCurrentMessage,
    dispatchAnim,
    locale: 'ru',
  });

  // Fetch initial position & welcome message. Screen geometry is Main-owned and
  // continuously supplied by useEnvironmentSnapshot.
  useEffect(() => {
    if (window.wispAPI?.getPosition) {
      window.wispAPI
        .getPosition()
        .then((pos) => {
          setPosition(pos);
        })
        .catch((err) => console.error('Failed to get position:', err));
    }

    // Welcome speech with cleanup
    const welcomeTimer = setTimeout(() => {
      setCurrentMessage(createChatMessage('pet', INTERACTION_REPLIES.welcome));
    }, 1000);

    return () => {
      clearTimeout(welcomeTimer);
    };
  }, []);

  const handleDismissMessage = useCallback(() => {
    setCurrentMessage(null);
  }, []);

  const handleSelectFace = useCallback(
    (face: AnimationExpressionHint | null) => {
      setCustomFace(face);
      const text = face
        ? (FACE_PREVIEW_REPLIES[face] ??
          `${FACE_PREVIEW_FALLBACK_PREFIX}${face}`)
        : FACE_PREVIEW_DEFAULT_REPLY;
      setCurrentMessage(createChatMessage('thought', text));
    },
    []
  );

  // Click & Double Click Interaction Handlers
  const handlePetClick = () => {
    if (hasMovedRef.current) return;

    if (animState === 'sleep') {
      sendCharacterInteraction({ type: 'click' });
      setCurrentMessage(
        createChatMessage('pet', INTERACTION_REPLIES.wakeFromClick)
      );
    } else {
      sendCharacterInteraction({ type: 'click' });
      const randomPhrase =
        CLICK_REPLIES[Math.floor(Math.random() * CLICK_REPLIES.length)] ??
        CLICK_REPLY_FALLBACK;
      setCurrentMessage(createChatMessage('pet', randomPhrase));
    }
  };

  const handlePetDoubleClick = () => {
    if (hasMovedRef.current) return;
    sendCharacterInteraction({ type: 'double_click', intensity: 2 });
    setChatOpen(true);
    setMenuOpen(false);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    sendCharacterInteraction({ type: 'right_click' });
    setChatOpen(false);
    setMenuOpen(true);
  };

  const handleResetPosition = useCallback(() => {
    const resetToCenter = (bounds: ScreenBoundsDTO): void => {
      const centeredPosition = {
        x: Math.round(
          bounds.x + (bounds.width - COMPACT_WINDOW_SIZE.width) / 2
        ),
        y: Math.round(
          bounds.y + (bounds.height - COMPACT_WINDOW_SIZE.height) / 2
        ),
      };

      if (window.wispAPI?.updatePosition) {
        void window.wispAPI
          .updatePosition(centeredPosition)
          .then((nextPosition) => {
            setPosition(nextPosition);
            setMenuOpen(false);
          })
          .catch((err: unknown) =>
            console.error('Failed to reset position:', err)
          );
      } else {
        setPosition(centeredPosition);
        setMenuOpen(false);
      }
    };

    void window.wispAPI
      ?.getEnvironmentSnapshot?.()
      ?.then((bounds) => {
        resetToCenter(bounds.screenBounds);
      })
      ?.catch((err: unknown) =>
        console.error('Failed to get environment snapshot:', err)
      );
  }, []);

  const handleClose = () => {
    if (window.wispAPI?.closeApp) {
      void window.wispAPI.closeApp();
    }
  };

  const handlePlayAnimation = useCallback(
    (event: AnimationEvent) => {
      if (event === 'START_SLEEP') {
        sendSleepWakeCommand({ action: 'sleep' });
        setCurrentMessage(
          createChatMessage('thought', INTERACTION_REPLIES.sleep)
        );
      } else if (event === 'WAKE_UP') {
        sendSleepWakeCommand({ action: 'wake' });
        setCurrentMessage(createChatMessage('pet', INTERACTION_REPLIES.wake));
      } else if (event === 'PET' || event === 'REACT_HAPPY') {
        sendCharacterInteraction({ type: 'pet' });
        dispatchAnim('PET', true, true);
        setCurrentMessage(
          createChatMessage('pet', INTERACTION_REPLIES.pet)
        );
      } else if (event === 'THINK') {
        dispatchAnim('THINK', true, true);
        setCurrentMessage(
          createChatMessage('thought', INTERACTION_REPLIES.think)
        );
      } else if (event === 'SPOOK' || event === 'REACT_CONFUSED') {
        sendCharacterInteraction({ type: 'click', intensity: 2 });
        dispatchAnim('SPOOK', true, true);
        setCurrentMessage(createChatMessage('pet', INTERACTION_REPLIES.spook));
      } else if (event === 'WAVE') {
        dispatchAnim('WAVE', true, true);
        setCurrentMessage(createChatMessage('pet', INTERACTION_REPLIES.wave));
      } else if (event === 'CELEBRATE') {
        dispatchAnim('CELEBRATE', true, true);
        setCurrentMessage(
          createChatMessage('pet', INTERACTION_REPLIES.celebrate)
        );
      } else if (event === 'BORED') {
        dispatchAnim('BORED', true, true);
        setCurrentMessage(
          createChatMessage('thought', INTERACTION_REPLIES.bored)
        );
      } else if (event === 'START_FLOAT') {
        dispatchAnim('START_FLOAT', true, true);
      } else if (event === 'START_DRAG') {
        dispatchAnim('START_DRAG', true, true);
      } else if (event === 'LAND') {
        dispatchAnim('LAND', true, false);
      } else if (event === 'SETTLE') {
        dispatchAnim('SETTLE', true, false);
      } else {
        dispatchAnim(event, true, true);
      }
    },
    [dispatchAnim, sendCharacterInteraction, sendSleepWakeCommand]
  );

  const debugHudElement = (
    <DebugHUD
      needs={debugTelemetry.character.needs}
      relationship={debugTelemetry.character.relationship}
      tone={debugTelemetry.character.synthesizedTone}
      animationState={animState}
      animationIntent={characterAnimationIntent}
      fps={renderFps}
      logs={debugTelemetry.logs}
      position={position}
      isWandering={isWandering}
      flipX={flipX}
      currentFace={customFace}
      bodyAnimationKeys={manifestAnimations.bodyKeys}
      faceAnimationKeys={manifestAnimations.faceKeys}
      selectedBodyAnimationKey={inspectorBodyKey}
      selectedFaceAnimationKey={inspectorFaceKey}
      showAnchorPoint={showAnchorPoint}
      onClearLogs={() => {
        const clearLogs = window.wispAPI?.clearDebugTelemetryLogs;
        if (clearLogs !== undefined) void clearLogs();
      }}
      onSelectBodyAnimation={(key) => {
        setInspectorBodyKey(key);
        if (key === null) setInspectorFaceKey(null);
      }}
      onSelectManifestFace={setInspectorFaceKey}
      onToggleAnchorPoint={() => setShowAnchorPoint((visible) => !visible)}
    />
  );

  return (
    <div
      className={`pet-container ${isDragging ? 'is-dragging' : ''} ${isWandering ? 'is-wandering' : ''} ${menuOpen ? 'menu-is-open' : ''}`}
    >
      {/* Speech Bubble */}
      <SpeechBubble
        message={currentMessage}
        onDismiss={handleDismissMessage}
      />

      {/* Chat Input */}
      <ChatInput
        isOpen={chatOpen}
        onSendMessage={handleUserSendMessage}
        onClose={() => setChatOpen(false)}
      />

      {/* Context Menu */}
      <ContextMenu
        isOpen={menuOpen}
        tone={debugTelemetry.character.synthesizedTone}
        currentTheme={currentTheme}
        scale={scale}
        autoWanderEnabled={autoWanderEnabled}
        isSleeping={animState === 'sleep_start' || animState === 'sleep_loop'}
        debugHudEnabled={debugHudEnabled}
        debugHudVisible={debugHudVisible}
        isAlwaysOnTop={isAlwaysOnTop}
        debugContent={debugHudElement}
        currentFace={customFace}
        onClose={() => setMenuOpen(false)}
        onPet={() => {
          sendCharacterInteraction({ type: 'pet' });
          setCurrentMessage(
            createChatMessage('pet', INTERACTION_REPLIES.pet)
          );
        }}
        onPlay={() => {
          sendCharacterInteraction({ type: 'play' });
          setCurrentMessage(
            createChatMessage('pet', INTERACTION_REPLIES.play)
          );
        }}
        onFeed={() => {
          sendCharacterInteraction({ type: 'feed' });
          setCurrentMessage(
            createChatMessage('pet', INTERACTION_REPLIES.feed)
          );
        }}
        onThink={() => {
          dispatchAnim('THINK', true, true);
          setMenuOpen(false);
          const randomThought =
            THOUGHTS[Math.floor(Math.random() * THOUGHTS.length)] ??
            THOUGHT_FALLBACK;
          setCurrentMessage(createChatMessage('thought', randomThought));
        }}
        onToggleSleep={() => {
          if (animState === 'sleep_start' || animState === 'sleep_loop') {
            sendSleepWakeCommand({ action: 'wake' });
            setCurrentMessage(
              createChatMessage('pet', INTERACTION_REPLIES.wake)
            );
          } else {
            sendSleepWakeCommand({ action: 'sleep' });
            setCurrentMessage(
              createChatMessage('thought', INTERACTION_REPLIES.sleep)
            );
          }
        }}
        onToggleWander={() => {
          const nextValue = !autoWanderEnabled;
          setAutoWanderEnabled(nextValue);
          void window.wispAPI
            ?.setAutonomyEnabled?.({ enabled: nextValue })
            ?.catch((err: unknown) =>
              console.error('Failed to toggle autonomy:', err)
            );
        }}
        onToggleDebugHud={() => setDebugHudVisible((visible) => !visible)}
        onToggleAlwaysOnTop={() => {
          const nextValue = !isAlwaysOnTop;
          void window.wispAPI
            ?.setAlwaysOnTop(nextValue)
            ?.then(setIsAlwaysOnTop)
            ?.catch((err: unknown) =>
              console.error('Failed to toggle always-on-top:', err)
            );
        }}
        onResetPosition={handleResetPosition}
        onPlayAnimation={handlePlayAnimation}
        onSelectFace={handleSelectFace}
        onSelectTheme={(t) => setCurrentTheme(t)}
        onSelectScale={(s) => setScale(s)}
        onQuit={handleClose}
      />

      <CharacterRenderer
        expression={expression}
        animationIntent={characterAnimationIntent}
        theme={currentTheme}
        scale={scale}
        flipX={flipX}
        isDragging={isDragging}
        tiltDeg={tiltDeg}
        debugAnimationSelection={debugAnimationSelection}
        showAnchorPoint={showAnchorPoint}
        onManifestAnimationsLoaded={handleManifestAnimationsLoaded}
        visualEpisodeId={visualEpisodeId}
        visualAgeMs={visualAgeMs}
        onAnimationCompleted={handleAnimationCompleted}
        onAnimationRejected={handleAnimationRejected}
        onMouseDown={handleMouseDown}
        onClick={handlePetClick}
        onDoubleClick={handlePetDoubleClick}
        onContextMenu={handleContextMenu}
      />

      {debugHudEnabled && debugHudVisible && !menuOpen ? debugHudElement : null}

      <div
        className="pet-label"
        onClick={(event) => {
          event.stopPropagation();
          setChatOpen((prev) => !prev);
          setMenuOpen(false);
        }}
      >
        💬 Wisp • {isWandering ? 'wandering' : animState}{' '}
        {debugTelemetry.character.synthesizedTone === 'affectionate'
          ? '💖'
          : ''}
      </div>
    </div>
  );
};

function animationStateToIntentKind(
  state: AnyAnimationState
): AnimationIntentKind {
  switch (state) {
    case 'float':
      return 'walk';
    case 'dragged':
      return 'dragged';
    case 'falling':
    case 'fall':
      return 'fall';
    case 'landing':
    case 'land':
      return 'land';
    case 'sleep':
    case 'sleep_loop':
      return 'sleep_loop';
    case 'sleep_start':
      return 'sleep_start';
    case 'wake_up':
      return 'wake_up';
    case 'happy':
      return 'happy_reaction';
    case 'surprised':
      return 'confused_reaction';
    case 'thinking':
      return 'thinking_loop';
    case 'spook':
      return 'spook';
    case 'wave':
      return 'wave';
    case 'celebrate':
      return 'celebrate';
    case 'bored':
      return 'bored';
    case 'settle':
      return 'settle';
    case 'sit':
      return 'sit';
    case 'stand_up':
      return 'stand_up';
    case 'lie_down':
      return 'lie_down';
    case 'get_up':
      return 'get_up';
    case 'run':
      return 'run';
    case 'jump':
      return 'jump';
    case 'crawl':
      return 'crawl';
    case 'climb_wall':
      return 'climb_wall';
    case 'hang_ceiling':
      return 'hang_ceiling';
    case 'idle':
    default:
      return 'idle_blink';
  }
}

function localTerminalKind(kind: AnimationIntentKind): AnimationIntentKind | null {
  if (kind === 'sleep_start') return 'sleep_loop';
  if (kind === 'land' || kind === 'crash_landing') return 'settle';
  if (
    kind === 'wake_up' ||
    kind === 'happy_reaction' ||
    kind === 'confused_reaction' ||
    kind === 'talking' ||
    kind === 'spook'
  ) return 'idle_blink';
  return null;
}

function synchronizeLocalAnimationState(
  kind: AnimationIntentKind,
  dispatch: (event: AnimationEvent, force?: boolean, loop?: boolean) => boolean,
  synchronizeTerminal: (state: TerminalAnimationState) => boolean
): void {
  if (kind === 'idle_blink') {
    synchronizeTerminal('idle');
    return;
  }
  if (kind === 'settle') {
    synchronizeTerminal('settle');
    return;
  }
  if (kind === 'sleep_loop') {
    synchronizeTerminal('sleep_loop');
    return;
  }
  const events: Partial<Record<AnimationIntentKind, AnimationEvent>> = {
    walk: 'START_FLOAT',
    sleep_start: 'START_SLEEP',
    wake_up: 'WAKE_UP',
    happy_reaction: 'REACT_HAPPY',
    confused_reaction: 'REACT_CONFUSED',
    thinking_loop: 'THINK',
    bored: 'BORED',
    wave: 'WAVE',
    celebrate: 'CELEBRATE',
    spook: 'SPOOK',
    dragged: 'START_DRAG',
    land: 'LAND',
    sit: 'SIT',
    stand_up: 'STAND_UP',
    lie_down: 'LIE_DOWN',
    get_up: 'GET_UP',
    run: 'RUN',
    jump: 'JUMP',
    fall: 'FALL',
    crawl: 'CRAWL',
    climb_wall: 'CLIMB_WALL',
    hang_ceiling: 'HANG_CEILING',
  };
  const event = events[kind];
  if (event !== undefined) dispatch(event, true, kind.endsWith('_loop'));
}

function expressionToHint(expr: CharacterExpression): AnimationExpressionHint {
  switch (expr) {
    case 'happy':
      return 'happy';
    case 'sleepy':
      return 'sleepy';
    case 'surprised':
    case 'flying':
      return 'surprised';
    case 'curious':
      return 'curious';
    case 'idle':
    default:
      return 'idle';
  }
}
