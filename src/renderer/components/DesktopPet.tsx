import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { DebugTelemetryDTO, PetPositionDTO, ScreenBoundsDTO } from '../../shared/ipc-contracts';
import { calculateDragInertia } from '../../domain/models/position';
import type { CharacterExpression, CharacterTheme } from '../../domain/models/character-visuals';
import { DEFAULT_THEMES } from '../../domain/models/character-visuals';
import { defaultCharacterStateService } from '../../application/services/character-state.service';
import type { ChatMessage } from '../../domain/chat/chat-message';
import { createChatMessage } from '../../domain/chat/chat-message';
import type { IAIProvider } from '../../application/ports/ai-provider.interface';
import { MockAIProvider } from '../../infrastructure/ai/mock-ai-provider';
import { CharacterRenderer } from './Character/CharacterRenderer';
import { ContextMenu } from './Interaction/ContextMenu';
import { SpeechBubble } from './Chat/SpeechBubble';
import { ChatInput } from './Chat/ChatInput';
import { useAnimationStateMachine } from '../hooks/useAnimationStateMachine';
import { useAutonomousBehavior } from '../hooks/useAutonomousBehavior';
import { useDialogueLoop } from '../hooks/useDialogueLoop';
import {
  createSystemAnimationIntent,
  type AnimationExpressionHint,
  type AnimationIntentKind,
} from '../../domain/animation/animation-intent';
import type { AnimationEvent, AnimationState } from '../../domain/animation/animation-state-machine';
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
  const [currentTheme, setCurrentTheme] = useState<CharacterTheme>(
    DEFAULT_THEMES.cosmic ?? Object.values(DEFAULT_THEMES)[0]!
  );
  const [scale, setScale] = useState<number>(1.0);
  const [debugHudVisible, setDebugHudVisible] = useState<boolean>(false);
  const [debugTelemetry, setDebugTelemetry] = useState<DebugTelemetryDTO>(EMPTY_DEBUG_TELEMETRY);
  const [renderFps, setRenderFps] = useState<number>(0);
  const debugHudEnabled = window.wispAPI.debugEnabled;

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
            prevMoveRef.current.x = newPos.x;
            prevMoveRef.current.y = newPos.y;
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
    petSize: menuOpen ? { width: 620, height: 500 } : COMPACT_WINDOW_SIZE,
    enabled: autoWanderEnabled,
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
    const expressionHint = expressionToHint(expression);
    return createSystemAnimationIntent(kind, 'neutral', {
      expressionHint,
    });
  }, [animState, expression, isWandering]);

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

  // Fetch initial position, screen bounds & welcome message
  useEffect(() => {
    if (window.wispAPI?.getScreenBounds) {
      window.wispAPI
        .getScreenBounds()
        .then((bounds) => setScreenBounds(bounds))
        .catch((err) => console.error('Failed to get screen bounds:', err));
    }

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

  const handleDismissMessage = useCallback(() => {
    setCurrentMessage(null);
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

        defaultCharacterStateService.applyStimulus({ type: 'user_drag_end', source: 'user' });

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
  }, [isDragging, dispatchAnim]);

  // Click & Double Click Interaction Handlers
  const handlePetClick = () => {
    if (hasMovedRef.current) return;

    if (animState === 'sleep') {
      wakeUp();
      setCurrentMessage(createChatMessage('pet', 'Я проснулся! ☀️'));
    } else {
      defaultCharacterStateService.applyStimulus({ type: 'click', source: 'user' });
      dispatchAnim('PET');
      const phrases = ['Мурр! ✨', 'Ты лучший! 💖', 'Хи-хи, щекотно!', 'Что делаем? 🚀'];
      const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)] ?? 'Мурр!';
      setCurrentMessage(createChatMessage('pet', randomPhrase));
    }
  };

  const handlePetDoubleClick = () => {
    if (hasMovedRef.current) return;
    defaultCharacterStateService.applyStimulus({ type: 'click', source: 'user', intensity: 2 });
    dispatchAnim('PET');
    setChatOpen(true);
    setMenuOpen(false);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setChatOpen(false);
    setMenuOpen((prev) => !prev);
  };

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
      defaultCharacterStateService.applyStimulus({ type: 'pet', source: 'user' });
      dispatchAnim('PET', true, true);
      setCurrentMessage(createChatMessage('pet', 'Люблю, когда гладят! 💖'));
    } else if (event === 'THINK') {
      dispatchAnim('THINK', true, true);
      setCurrentMessage(createChatMessage('thought', 'Хм-м, о чём бы поразмышлять?.. 🤔'));
    } else if (event === 'SPOOK' || event === 'REACT_CONFUSED') {
      defaultCharacterStateService.applyStimulus({ type: 'user_click', source: 'user', intensity: 2 });
      dispatchAnim('SPOOK', true, true);
      setCurrentMessage(createChatMessage('pet', 'Ой! 😲'));
    } else if (event === 'WAVE') {
      dispatchAnim('WAVE', true, true);
      setCurrentMessage(createChatMessage('pet', 'Привет-привет! 👋'));
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
  }, [dispatchAnim, triggerNap, wakeUp]);

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
      onClearLogs={() => {
        const clearLogs = window.wispAPI.clearDebugTelemetryLogs;
        if (clearLogs !== undefined) void clearLogs();
      }}
      onPlayAnimation={handlePlayAnimation}
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
        debugContent={debugHudElement}
        onClose={() => setMenuOpen(false)}
        onPet={() => {
          defaultCharacterStateService.applyStimulus({ type: 'pet', source: 'user' });
          dispatchAnim('PET', true, true);
          setCurrentMessage(createChatMessage('pet', 'Люблю, когда гладят! 💖'));
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
        onPlayAnimation={handlePlayAnimation}
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

function animationStateToIntentKind(state: AnimationState): AnimationIntentKind {
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
