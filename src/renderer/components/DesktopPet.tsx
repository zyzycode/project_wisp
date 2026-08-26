import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { SystemInfoDTO, PetPositionDTO, ScreenBoundsDTO } from '../../shared/ipc-contracts';
import { calculateDragInertia } from '../../domain/models/position';
import type { CharacterTheme } from '../../domain/models/character-visuals';
import { DEFAULT_THEMES, DEFAULT_THEME } from '../../domain/models/character-visuals';
import { CharacterRenderer } from './Character/CharacterRenderer';
import { PetMenu } from './PetMenu';
import { useAnimationStateMachine } from '../hooks/useAnimationStateMachine';
import { useAutonomousBehavior } from '../hooks/useAutonomousBehavior';

export const DesktopPet: React.FC = () => {
  const [systemInfo, setSystemInfo] = useState<SystemInfoDTO | null>(null);
  const [screenBounds, setScreenBounds] = useState<ScreenBoundsDTO | null>(null);
  const [position, setPosition] = useState<PetPositionDTO>({ x: 300, y: 300 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [tiltDeg, setTiltDeg] = useState<number>(0);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [autoWanderEnabled, setAutoWanderEnabled] = useState<boolean>(true);
  const [currentTheme, setCurrentTheme] = useState<CharacterTheme>(
    DEFAULT_THEMES.cosmic ?? DEFAULT_THEME
  );
  const [scale, setScale] = useState<number>(1.0);

  const { state: animState, expression, dispatch: dispatchAnim } = useAnimationStateMachine('idle');

  const handlePositionChange = useCallback((newPos: PetPositionDTO) => {
    setPosition(newPos);
    if (window.wispAPI?.updatePosition) {
      void window.wispAPI.updatePosition(newPos);
    }
  }, []);

  const { isWandering, triggerNap, wakeUp } = useAutonomousBehavior({
    currentPosition: position,
    screenBounds,
    animState,
    isDragging,
    petSize: { width: Math.round(100 * scale), height: Math.round(100 * scale) },
    enabled: autoWanderEnabled,
    onPositionChange: handlePositionChange,
    dispatchAnim,
  });

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

  useEffect(() => {
    if (window.wispAPI?.getSystemInfo) {
      window.wispAPI.getSystemInfo().then(setSystemInfo).catch(console.error);
    }
    if (window.wispAPI?.getScreenBounds) {
      window.wispAPI.getScreenBounds().then(setScreenBounds).catch(console.error);
    }
    if (window.wispAPI?.getPosition) {
      window.wispAPI.getPosition().then((pos) => {
        setPosition(pos);
        dragStartRef.current.petX = pos.x;
        dragStartRef.current.petY = pos.y;
      }).catch(console.error);
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (window.wispAPI?.setIgnoreMouseEvents) {
      void window.wispAPI.setIgnoreMouseEvents({ ignore: false });
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!isDragging && !menuOpen && window.wispAPI?.setIgnoreMouseEvents) {
      void window.wispAPI.setIgnoreMouseEvents({ ignore: true, forward: true });
    }
  }, [isDragging, menuOpen]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;

    setIsDragging(true);
    dispatchAnim('START_DRAG');
    if (window.wispAPI?.setDragState) {
      void window.wispAPI.setDragState(true);
    }
    if (window.wispAPI?.setIgnoreMouseEvents) {
      void window.wispAPI.setIgnoreMouseEvents({ ignore: false });
    }

    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
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
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartRef.current.mouseX;
      const deltaY = e.clientY - dragStartRef.current.mouseY;
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
        prevMoveRef.current = { x: rawTargetX, y: rawTargetY, time: now };
      }

      setPosition({ x: rawTargetX, y: rawTargetY });

      if (window.wispAPI?.updatePosition) {
        window.wispAPI.updatePosition({ x: rawTargetX, y: rawTargetY })
          .then(setPosition)
          .catch(console.error);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setTiltDeg(0);
      dispatchAnim('RELEASE_DRAG');
      if (window.wispAPI?.setDragState) {
        void window.wispAPI.setDragState(false);
      }
      setTimeout(() => dispatchAnim('LAND'), 180);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dispatchAnim]);

  return (
    <div
      className={`pet-container ${isDragging ? 'is-dragging' : ''} ${isWandering ? 'is-wandering' : ''}`}
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {menuOpen && (
        <PetMenu
          systemInfo={systemInfo}
          animState={animState}
          expression={expression}
          isWandering={isWandering}
          currentTheme={currentTheme}
          scale={scale}
          autoWanderEnabled={autoWanderEnabled}
          onToggleAutoWander={() => setAutoWanderEnabled(!autoWanderEnabled)}
          onTriggerSleepToggle={() => (animState === 'sleep' ? wakeUp() : triggerNap())}
          onSelectTheme={setCurrentTheme}
          onSelectScale={setScale}
          onClose={() => {
            if (window.wispAPI?.closeApp) void window.wispAPI.closeApp();
          }}
        />
      )}

      <CharacterRenderer
        expression={expression}
        theme={currentTheme}
        scale={scale}
        isDragging={isDragging}
        tiltDeg={tiltDeg}
        onMouseDown={handleMouseDown}
        onClick={() => {
          if (isDragging) return;
          if (animState === 'sleep') wakeUp();
          else dispatchAnim('PET');
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(!menuOpen);
        }}
      />

      <div className="pet-label" onClick={() => setMenuOpen(!menuOpen)}>
        Wisp • {isWandering ? 'wandering' : animState}
      </div>
    </div>
  );
};
