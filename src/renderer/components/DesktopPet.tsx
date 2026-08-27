import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { PetPositionDTO, ScreenBoundsDTO } from '../../shared/ipc-contracts';
import { calculateDragInertia } from '../../domain/models/position';
import type { CharacterTheme } from '../../domain/models/character-visuals';
import { DEFAULT_THEMES } from '../../domain/models/character-visuals';
import {
  PetAffectionState,
  INITIAL_AFFECTION_STATE,
  recordPetInteraction,
  calculateAffectionDecay,
} from '../../domain/interaction/pet-interaction';
import type { ChatMessage } from '../../domain/chat/chat-message';
import { createChatMessage } from '../../domain/chat/chat-message';
import { CharacterRenderer } from './Character/CharacterRenderer';
import { ContextMenu } from './Interaction/ContextMenu';
import { SpeechBubble } from './Chat/SpeechBubble';
import { ChatInput } from './Chat/ChatInput';
import { useAnimationStateMachine } from '../hooks/useAnimationStateMachine';
import { useAutonomousBehavior } from '../hooks/useAutonomousBehavior';

const COMPACT_WINDOW_SIZE = { width: 280, height: 320 };

export const DesktopPet: React.FC = () => {
  const [screenBounds, setScreenBounds] = useState<ScreenBoundsDTO | null>(null);
  const [position, setPosition] = useState<PetPositionDTO>({ x: 300, y: 300 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [tiltDeg, setTiltDeg] = useState<number>(0);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [chatOpen, setChatOpen] = useState<boolean>(false);
  const [currentMessage, setCurrentMessage] = useState<ChatMessage | null>(null);
  const [autoWanderEnabled, setAutoWanderEnabled] = useState<boolean>(true);
  const [affection, setAffection] = useState<PetAffectionState>(INITIAL_AFFECTION_STATE);
  const [currentTheme, setCurrentTheme] = useState<CharacterTheme>(
    DEFAULT_THEMES.cosmic ?? Object.values(DEFAULT_THEMES)[0]!
  );
  const [scale, setScale] = useState<number>(1.0);

  // Animation State Machine Hook (FSM)
  const { state: animState, expression, dispatch: dispatchAnim } = useAnimationStateMachine('idle');

  // Autonomous Behavior Hook
  const { isWandering, triggerNap, wakeUp } = useAutonomousBehavior({
    currentPosition: position,
    screenBounds,
    animState,
    isDragging,
    petSize: COMPACT_WINDOW_SIZE,
    enabled: autoWanderEnabled,
    onPositionChange: (newPos) => {
      setPosition(newPos);
      if (window.wispAPI?.updatePosition) {
        void window.wispAPI.updatePosition(newPos);
      }
    },
    dispatchAnim,
  });

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

  // Fetch initial position, screen bounds, affection decay & welcome message
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

    // Affection decay interval
    const decayInterval = setInterval(() => {
      setAffection((prev) => calculateAffectionDecay(prev));
    }, 60000);

    return () => {
      clearTimeout(welcomeTimer);
      clearInterval(decayInterval);
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

        setAffection((prev) => recordPetInteraction(prev, 'drag_end'));

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
      setAffection((prev) => recordPetInteraction(prev, 'single_click'));
      dispatchAnim('PET');
      const phrases = ['Мурр! ✨', 'Ты лучший! 💖', 'Хи-хи, щекотно!', 'Что делаем? 🚀'];
      const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)] ?? 'Мурр!';
      setCurrentMessage(createChatMessage('pet', randomPhrase));
    }
  };

  const handlePetDoubleClick = () => {
    if (hasMovedRef.current) return;
    setAffection((prev) => recordPetInteraction(prev, 'double_click'));
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

  const handleUserSendMessage = (text: string) => {
    setAffection((prev) => recordPetInteraction(prev, 'single_click'));
    dispatchAnim('PET');
    setCurrentMessage(createChatMessage('pet', `«${text}» — я тебя слышу! ✨`));
  };

  const handleClose = () => {
    if (window.wispAPI?.closeApp) {
      void window.wispAPI.closeApp();
    }
  };

  return (
    <div
      className={`pet-container ${isDragging ? 'is-dragging' : ''} ${isWandering ? 'is-wandering' : ''}`}
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
        affection={affection}
        currentTheme={currentTheme}
        scale={scale}
        autoWanderEnabled={autoWanderEnabled}
        isSleeping={animState === 'sleep'}
        onClose={() => setMenuOpen(false)}
        onPet={() => {
          setAffection((prev) => recordPetInteraction(prev, 'petting'));
          dispatchAnim('PET');
          setCurrentMessage(createChatMessage('pet', 'Люблю, когда гладят! 💖'));
        }}
        onSpook={() => {
          dispatchAnim('SPOOK');
          setCurrentMessage(createChatMessage('thought', 'Ой, что это было?! 👻'));
        }}
        onToggleSleep={() => {
          if (animState === 'sleep') {
            wakeUp();
            setCurrentMessage(createChatMessage('pet', 'Доброе утро! ☀️'));
          } else {
            triggerNap();
            setCurrentMessage(createChatMessage('thought', 'Zzz... 🌙'));
          }
        }}
        onToggleWander={() => setAutoWanderEnabled((prev) => !prev)}
        onSelectTheme={(t) => setCurrentTheme(t)}
        onSelectScale={(s) => setScale(s)}
        onQuit={handleClose}
      />

      <CharacterRenderer
        expression={expression}
        theme={currentTheme}
        scale={scale}
        isDragging={isDragging}
        tiltDeg={tiltDeg}
        onMouseDown={handleMouseDown}
        onClick={handlePetClick}
        onDoubleClick={handlePetDoubleClick}
        onContextMenu={handleContextMenu}
      />

      <div
        className="pet-label"
        onClick={() => {
          setChatOpen((prev) => !prev);
          setMenuOpen(false);
        }}
      >
        💬 Wisp • {isWandering ? 'wandering' : animState} {affection.mood === 'delighted' ? '💖' : ''}
      </div>
    </div>
  );
};
