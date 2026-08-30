import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type {
  CharacterInteractionDTO,
  DebugTelemetryDTO,
  PetPositionDTO,
  ScreenBoundsDTO,
} from '../../shared/ipc-contracts';
import { calculateDragInertia } from '../../domain/models/position';
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
import { useAutonomousBehavior } from '../hooks/useAutonomousBehavior';
import { useEnvironmentSnapshot } from '../hooks/useEnvironmentSnapshot';
import { useDialogueLoop } from '../hooks/useDialogueLoop';
import {
  createSystemAnimationIntent,
  type AnimationExpressionHint,
  type AnimationIntentKind,
} from '../../domain/animation/animation-intent';
import type { AnimationEvent, AnyAnimationState } from '../../domain/animation/animation-state-machine';
import { DebugHUD } from './Debug';

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
  const [screenBounds, setScreenBounds] = useState<ScreenBoundsDTO | null>(null);
  const [position, setPosition] = useState<PetPositionDTO>({ x: 300, y: 300 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [tiltDeg, setTiltDeg] = useState<number>(0);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [chatOpen, setChatOpen] = useState<boolean>(false);
  const [currentMessage, setCurrentMessage] = useState<ChatMessage | null>(null);
  const [autoWanderEnabled, setAutoWanderEnabled] = useState<boolean>(true);
  const [customFace, setCustomFace] = useState<AnimationExpressionHint | null>(null);
  const [currentTheme, setCurrentTheme] = useState<CharacterTheme>(
    DEFAULT_THEMES.cosmic ?? Object.values(DEFAULT_THEMES)[0]!
  );
  const [scale, setScale] = useState<number>(1.0);
  const [debugHudVisible, setDebugHudVisible] = useState<boolean>(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState<boolean>(true);
  const [manifestAnimations, setManifestAnimations] = useState<ManifestAnimationRegistry>({
    bodyKeys: [],
    faceKeys: [],
  });
  const [inspectorBodyKey, setInspectorBodyKey] = useState<string | null>(null);
  const [inspectorFaceKey, setInspectorFaceKey] = useState<string | null>(null);
  const [showAnchorPoint, setShowAnchorPoint] = useState<boolean>(false);
  const [debugTelemetry, setDebugTelemetry] = useState<DebugTelemetryDTO>(EMPTY_DEBUG_TELEMETRY);
  const [renderFps, setRenderFps] = useState<number>(0);
  const debugHudEnabled = window.wispAPI.debugEnabled;
  const environmentSnapshot = useEnvironmentSnapshot();

  const sendCharacterInteraction = useCallback((interaction: CharacterInteractionDTO): void => {
    void window.wispAPI.interactWithCharacter(interaction)
      .catch((err) => console.error('Character interaction failed:', err));
  }, []);

  // Animation State Machine Hook (FSM)
  const { state: animState, expression, dispatch: dispatchAnim } = useAnimationStateMachine('idle');

  // Drag & Click reference trackers
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; petX: number; petY: number }>({
    mouseX: 0,
    mouseY: 0,
    petX: 300,
    petY: 300,
  });
  const prevMoveRef = useRef<{ x: number; y: number; time: number }>({
    x: 300,
    y: 300,
    time: Date.now(),
  });
  const clickTimeRef = useRef<number>(0);
  const hasMovedRef = useRef<boolean>(false);
  const landingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Notify Electron main process when menu expands or collapses and synchronize position
  useEffect(() => {
    if (window.wispAPI?.setMenuExpanded) {
      window.wispAPI
        .setMenuExpanded(menuOpen)
        .then((newPos) => {
          if (newPos) {
            setPosition(newPos);
            dragStartRef.current.petX = newPos.x;
            dragStartRef.current.petY = newPos.y;
          }
        })
        .catch((err) => console.error('Failed to update menu expanded state:', err));
    }
  }, [menuOpen]);

  // Autonomous Behavior Hook
  const { isWandering, flipX, triggerNap, wakeUp } = useAutonomousBehavior({
    currentPosition: position,
    screenBounds,
    animState,
    isDragging,
    petSize: menuOpen ? { width: 880, height: 580 } : COMPACT_WINDOW_SIZE,
    enabled: autoWanderEnabled && !menuOpen,
    onPositionChange: (newPos) => {
      setPosition(newPos);
      if (window.wispAPI?.updatePosition) {
        void window.wispAPI.updatePosition(newPos);
      }
    },
    dispatchAnim,
  });

  const characterAnimationIntent = useMemo(() => {
    const kind = isWandering ? 'walk' : animationStateToIntentKind(animState);
    const defaultHint = expressionToHint(expression);
    const expressionHint = customFace ?? defaultHint;
    return createSystemAnimationIntent(kind, 'neutral', {
      expressionHint,
    });
  }, [animState, expression, isWandering, customFace]);

  const debugAnimationSelection = useMemo<DebugAnimationSelection | undefined>(() => {
    if (inspectorBodyKey === null) return undefined;
    return {
      bodyKey: inspectorBodyKey,
      ...(inspectorFaceKey === null ? {} : { faceKey: inspectorFaceKey }),
    };
  }, [inspectorBodyKey, inspectorFaceKey]);

  const handleManifestAnimationsLoaded = useCallback((registry: ManifestAnimationRegistry): void => {
    setManifestAnimations(registry);
  }, []);

  useEffect(() => {
    if (!debugHudEnabled || (!debugHudVisible && !menuOpen)) return undefined;
    const getDebugTelemetry = window.wispAPI.getDebugTelemetry;
    const onDebugTelemetry = window.wispAPI.onDebugTelemetry;
    if (getDebugTelemetry === undefined || onDebugTelemetry === undefined) return undefined;
    let active = true;
    const refreshTelemetry = (): void => {
      void getDebugTelemetry()
        .then((telemetry) => { if (active) setDebugTelemetry(telemetry); })
        .catch(() => undefined);
    };
    refreshTelemetry();
    const unsubscribe = onDebugTelemetry((telemetry) => setDebugTelemetry(telemetry));
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
          dragStartRef.current.petX = pos.x;
          dragStartRef.current.petY = pos.y;
        })
        .catch((err) => console.error('Failed to get position:', err));
    }

    // Welcome speech with cleanup
    const welcomeTimer = setTimeout(() => {
      setCurrentMessage(createChatMessage('pet', 'Привет! Я Wisp ✨'));
    }, 1000);

    return () => {
      clearTimeout(welcomeTimer);
      if (landingTimerRef.current) {
        clearTimeout(landingTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (environmentSnapshot) {
      setScreenBounds(environmentSnapshot.screenBounds);
    }
  }, [environmentSnapshot]);

  const handleDismissMessage = useCallback(() => {
    setCurrentMessage(null);
  }, []);

  const handleSelectFace = useCallback((face: AnimationExpressionHint | null) => {
    setCustomFace(face);
    const faceMessages: Record<string, string> = {
      happy: 'Улыбаюсь! 😊',
      sad: 'Мне немного грустно... 🥺',
      shocked: 'Ого, ничего себе! 😲',
      sleepy: 'Глазки слипаются... 😴',
      talking: 'Что-то рассказываю! 💬',
      thinking: 'Хм, интересно... 🤔',
      angry: 'Я сержусь! 😠',
    };
    const text = face ? (faceMessages[face] ?? `Выражение: ${face}`) : 'Обычное выражение ✨';
    setCurrentMessage(createChatMessage('thought', text));
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left click only for dragging / gestures

    if (landingTimerRef.current) {
      clearTimeout(landingTimerRef.current);
      landingTimerRef.current = null;
    }

    hasMovedRef.current = false;
    clickTimeRef.current = Date.now();

    dragStartRef.current = {
      mouseX: e.screenX,
      mouseY: e.screenY,
      petX: position.x,
      petY: position.y,
    };

    prevMoveRef.current = {
      x: position.x,
      y: position.y,
      time: Date.now(),
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.screenX - dragStartRef.current.mouseX;
      const deltaY = e.screenY - dragStartRef.current.mouseY;

      // Threshold to detect start of drag
      if (!isDragging && (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4)) {
        if (clickTimeRef.current > 0) {
          setIsDragging(true);
          hasMovedRef.current = true;
          setMenuOpen(false);
          setChatOpen(false);
          dispatchAnim('START_DRAG');
        }
      }

      if (!isDragging) return;

      const rawTargetX = dragStartRef.current.petX + deltaX;
      const rawTargetY = dragStartRef.current.petY + deltaY;

      const now = Date.now();
      const dt = now - prevMoveRef.current.time;

      if (dt > 16) {
        const inertia = calculateDragInertia(
          { x: rawTargetX, y: rawTargetY },
          { x: prevMoveRef.current.x, y: prevMoveRef.current.y },
          dt
        );
        setTiltDeg(inertia.tiltDeg);

        prevMoveRef.current = {
          x: rawTargetX,
          y: rawTargetY,
          time: now,
        };
      }

      if (window.wispAPI?.updatePosition) {
        window.wispAPI
          .updatePosition({ x: rawTargetX, y: rawTargetY })
          .then((clamped) => {
            setPosition(clamped);
          })
          .catch((err) => console.error('Position update error:', err));
      }
    };

    const handleMouseUp = () => {
      clickTimeRef.current = 0;

      if (isDragging) {
        setIsDragging(false);
        setTiltDeg(0);
        dispatchAnim('RELEASE_DRAG');

        sendCharacterInteraction({ type: 'drag_end' });

        // Trigger landing animation after brief drop with managed timer
        if (landingTimerRef.current) {
          clearTimeout(landingTimerRef.current);
        }
        landingTimerRef.current = setTimeout(() => {
          dispatchAnim('LAND');
          landingTimerRef.current = null;
        }, 180);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dispatchAnim, sendCharacterInteraction]);

  // Click & Double Click Interaction Handlers
  const handlePetClick = () => {
    if (hasMovedRef.current) return;

    if (animState === 'sleep') {
      wakeUp();
      setCurrentMessage(createChatMessage('pet', 'Я проснулся! ☀️'));
    } else {
      sendCharacterInteraction({ type: 'click' });
      dispatchAnim('PET');
      const phrases = ['Мурр! ✨', 'Ты лучший! 💖', 'Хи-хи, щекотно!', 'Что делаем? 🚀'];
      const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)] ?? 'Мурр!';
      setCurrentMessage(createChatMessage('pet', randomPhrase));
    }
  };

  const handlePetDoubleClick = () => {
    if (hasMovedRef.current) return;
    sendCharacterInteraction({ type: 'double_click', intensity: 2 });
    dispatchAnim('PET');
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
        x: Math.round(bounds.x + (bounds.width - COMPACT_WINDOW_SIZE.width) / 2),
        y: Math.round(bounds.y + (bounds.height - COMPACT_WINDOW_SIZE.height) / 2),
      };

      void window.wispAPI.updatePosition(centeredPosition).then((nextPosition) => {
        setPosition(nextPosition);
        dragStartRef.current.petX = nextPosition.x;
        dragStartRef.current.petY = nextPosition.y;
        setMenuOpen(false);
      }).catch((err) => console.error('Failed to reset position:', err));
    };

    void window.wispAPI.getEnvironmentSnapshot()
      .then((bounds) => {
        setScreenBounds(bounds.screenBounds);
        resetToCenter(bounds.screenBounds);
      })
      .catch((err) => console.error('Failed to get environment snapshot:', err));
  }, []);

  const handleClose = () => {
    if (window.wispAPI?.closeApp) {
      void window.wispAPI.closeApp();
    }
  };

  const handlePlayAnimation = useCallback((event: AnimationEvent) => {
    if (event === 'START_SLEEP') {
      triggerNap();
      dispatchAnim('START_SLEEP', true, true);
      setCurrentMessage(createChatMessage('thought', 'Zzz... 🌙'));
    } else if (event === 'WAKE_UP') {
      wakeUp();
      dispatchAnim('WAKE_UP', true, false);
      setCurrentMessage(createChatMessage('pet', 'Доброе утро! ☀️'));
    } else if (event === 'PET' || event === 'REACT_HAPPY') {
      sendCharacterInteraction({ type: 'pet' });
      dispatchAnim('PET', true, true);
      setCurrentMessage(createChatMessage('pet', 'Люблю, когда гладят! 💖'));
    } else if (event === 'THINK') {
      dispatchAnim('THINK', true, true);
      setCurrentMessage(createChatMessage('thought', 'Хм-м, о чём бы поразмышлять?.. 🤔'));
    } else if (event === 'SPOOK' || event === 'REACT_CONFUSED') {
      sendCharacterInteraction({ type: 'click', intensity: 2 });
      dispatchAnim('SPOOK', true, true);
      setCurrentMessage(createChatMessage('pet', 'Ой! 😲'));
    } else if (event === 'WAVE') {
      dispatchAnim('WAVE', true, true);
      setCurrentMessage(createChatMessage('pet', 'Привет-привет! 🖐️'));
    } else if (event === 'CELEBRATE') {
      dispatchAnim('CELEBRATE', true, true);
      setCurrentMessage(createChatMessage('pet', 'Ура-а! Празднуем! 🎉'));
    } else if (event === 'BORED') {
      dispatchAnim('BORED', true, true);
      setCurrentMessage(createChatMessage('thought', 'Эх, скучновато... 🥱'));
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
  }, [dispatchAnim, sendCharacterInteraction, triggerNap, wakeUp]);

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
        const clearLogs = window.wispAPI.clearDebugTelemetryLogs;
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
        isSleeping={animState === 'sleep'}
        debugHudEnabled={debugHudEnabled}
        debugHudVisible={debugHudVisible}
        isAlwaysOnTop={isAlwaysOnTop}
        debugContent={debugHudElement}
        currentFace={customFace}
        onClose={() => setMenuOpen(false)}
        onPet={() => {
          sendCharacterInteraction({ type: 'pet' });
          dispatchAnim('PET', true, true);
          setCurrentMessage(createChatMessage('pet', 'Люблю, когда гладят! 💖'));
        }}
        onPlay={() => {
          sendCharacterInteraction({ type: 'play' });
          dispatchAnim('RUN', true, false);
          setCurrentMessage(createChatMessage('pet', 'Давай играть! Догони меня! 🎮'));
        }}
        onFeed={() => {
          sendCharacterInteraction({ type: 'feed' });
          dispatchAnim('REACT_HAPPY', true, false);
          setCurrentMessage(createChatMessage('pet', 'Спасибо за угощение! Вкусно! 🍪'));
        }}
        onThink={() => {
          dispatchAnim('THINK', true, true);
          setMenuOpen(false);
          const thoughts = [
            'Хм-м, о чём бы поразмышлять?.. 🤔',
            'Интересно, как устроен этот мир? ✨',
            'А звёзды сегодня такие яркие... 💭',
            'Думаю о чём-то приятном! 🌸',
          ];
          const randomThought = thoughts[Math.floor(Math.random() * thoughts.length)] ?? 'Хм-м... 🤔';
          setCurrentMessage(createChatMessage('thought', randomThought));
        }}
        onToggleSleep={() => {
          if (animState === 'sleep') {
            wakeUp();
            dispatchAnim('WAKE_UP', true, false);
            setCurrentMessage(createChatMessage('pet', 'Доброе утро! ☀️'));
          } else {
            triggerNap();
            dispatchAnim('START_SLEEP', true, true);
            setCurrentMessage(createChatMessage('thought', 'Zzz... 🌙'));
          }
        }}
        onToggleWander={() => setAutoWanderEnabled((prev) => !prev)}
        onToggleDebugHud={() => setDebugHudVisible((visible) => !visible)}
        onToggleAlwaysOnTop={() => {
          const nextValue = !isAlwaysOnTop;
          void window.wispAPI.setAlwaysOnTop(nextValue)
            .then(setIsAlwaysOnTop)
            .catch((err) => console.error('Failed to toggle always-on-top:', err));
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
        💬 Wisp • {isWandering ? 'wandering' : animState} {debugTelemetry.character.synthesizedTone === 'affectionate' ? '💖' : ''}
      </div>
    </div>
  );
};

function animationStateToIntentKind(state: AnyAnimationState): AnimationIntentKind {
  switch (state) {
    case 'float': return 'walk';
    case 'dragged': return 'dragged';
    case 'falling': return 'dragged';
    case 'landing': return 'land';
    case 'sleep':
    case 'sleep_loop': return 'sleep_loop';
    case 'sleep_start': return 'sleep_start';
    case 'wake_up': return 'wake_up';
    case 'happy': return 'happy_reaction';
    case 'surprised': return 'confused_reaction';
    case 'thinking': return 'thinking_loop';
    case 'spook': return 'spook';
    case 'wave': return 'wave';
    case 'celebrate': return 'celebrate';
    case 'bored': return 'bored';
    case 'settle': return 'settle';
    case 'sit': return 'sit';
    case 'stand_up': return 'stand_up';
    case 'lie_down': return 'lie_down';
    case 'get_up': return 'get_up';
    case 'run': return 'run';
    case 'jump': return 'jump';
    case 'fall': return 'fall';
    case 'land': return 'land';
    case 'crawl': return 'crawl';
    case 'climb_wall':
    case 'hang_ceiling': return 'crawl';
    case 'idle': return 'idle_blink';
  }
}

function expressionToHint(expr: CharacterExpression): AnimationExpressionHint {
  switch (expr) {
    case 'happy': return 'happy';
    case 'sleepy': return 'sleepy';
    case 'surprised':
    case 'flying': return 'surprised';
    case 'curious': return 'curious';
    case 'idle':
    default: return 'idle';
  }
}
