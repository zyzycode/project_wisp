import React, { useState, useEffect, useRef } from 'react';
import type { SystemInfoDTO, PetPositionDTO } from '../../shared/ipc-contracts';
import { calculateDragInertia } from '../../domain/models/position';
import type { CharacterTheme } from '../../domain/models/character-visuals';
import { DEFAULT_THEMES, DEFAULT_THEME } from '../../domain/models/character-visuals';
import { CharacterRenderer } from './Character/CharacterRenderer';
import { useAnimationStateMachine } from '../hooks/useAnimationStateMachine';

export const DesktopPet: React.FC = () => {
  const [systemInfo, setSystemInfo] = useState<SystemInfoDTO | null>(null);
  const [position, setPosition] = useState<PetPositionDTO>({ x: 300, y: 300 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [tiltDeg, setTiltDeg] = useState<number>(0);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [currentTheme, setCurrentTheme] = useState<CharacterTheme>(DEFAULT_THEME);
  const [scale, setScale] = useState<number>(1.0);

  // Animation State Machine Hook (FSM)
  const { state: animState, expression, dispatch } = useAnimationStateMachine('idle');

  // Drag references using screen-space coordinates
  const isDraggingRef = useRef<boolean>(false);
  const landingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartRef = useRef<{
    mouseScreenX: number;
    mouseScreenY: number;
    windowX: number;
    windowY: number;
  }>({
    mouseScreenX: 0,
    mouseScreenY: 0,
    windowX: 300,
    windowY: 300,
  });
  const prevMoveRef = useRef<{ x: number; y: number; time: number }>({
    x: 300,
    y: 300,
    time: Date.now(),
  });

  // Fetch initial position & system info
  useEffect(() => {
    let isMounted = true;

    const fetchInfo = async () => {
      try {
        if (window.wispAPI?.getSystemInfo) {
          const info = await window.wispAPI.getSystemInfo();
          if (isMounted) setSystemInfo(info);
        }
        if (window.wispAPI?.getPosition) {
          const pos = await window.wispAPI.getPosition();
          if (isMounted) {
            setPosition(pos);
            dragStartRef.current.windowX = pos.x;
            dragStartRef.current.windowY = pos.y;
          }
        }
      } catch (err) {
        console.error('Failed to initialize desktop pet:', err);
      }
    };

    void fetchInfo();

    return () => {
      isMounted = false;
      if (landingTimerRef.current) {
        clearTimeout(landingTimerRef.current);
        landingTimerRef.current = null;
      }
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left click only for dragging

    if (landingTimerRef.current) {
      clearTimeout(landingTimerRef.current);
      landingTimerRef.current = null;
    }

    isDraggingRef.current = true;
    setIsDragging(true);
    dispatch('START_DRAG');

    dragStartRef.current = {
      mouseScreenX: e.screenX,
      mouseScreenY: e.screenY,
      windowX: position.x,
      windowY: position.y,
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
      const deltaX = e.screenX - dragStartRef.current.mouseScreenX;
      const deltaY = e.screenY - dragStartRef.current.mouseScreenY;

      const rawTargetX = dragStartRef.current.windowX + deltaX;
      const rawTargetY = dragStartRef.current.windowY + deltaY;

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

      setPosition({ x: rawTargetX, y: rawTargetY });

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
      isDraggingRef.current = false;
      setIsDragging(false);
      setTiltDeg(0);
      dispatch('RELEASE_DRAG');

      // Trigger landing animation after brief drop with tracked timer cleanup
      if (landingTimerRef.current) {
        clearTimeout(landingTimerRef.current);
      }
      landingTimerRef.current = setTimeout(() => {
        dispatch('LAND');
        landingTimerRef.current = null;
      }, 180);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dispatch]);

  const handlePetClick = () => {
    if (isDraggingRef.current) return;
    if (animState === 'sleep') {
      dispatch('WAKE_UP');
    } else {
      dispatch('PET');
    }
  };

  const handleClose = () => {
    if (window.wispAPI?.closeApp) {
      void window.wispAPI.closeApp();
    }
  };

  return (
    <div className={`pet-container ${isDragging ? 'is-dragging' : ''}`}>
      {menuOpen && (
        <div className="pet-menu" onClick={(e) => e.stopPropagation()}>
          <h4>✨ Wisp Companion (Phase 5)</h4>
          <div className="pet-menu-info">
            <span>ОС: <strong>{systemInfo?.platform || 'linux'}</strong> ({systemInfo?.sessionType || 'x11'})</span>
            <span>Состояние FSM: <strong>{animState}</strong></span>
            <span>Эмоция: <strong>{expression}</strong></span>
            <span>Тема: <strong>{currentTheme.name}</strong></span>
            <span>Масштаб: <strong>{Math.round(scale * 100)}%</strong></span>
          </div>

          <div className="pet-menu-section">Анимации / Поведение:</div>
          <div className="pet-theme-picker">
            <button
              className="pet-btn"
              onClick={() => dispatch('PET')}
            >
              Радость
            </button>
            <button
              className="pet-btn"
              onClick={() => dispatch('SPOOK')}
            >
              Испуг
            </button>
            <button
              className="pet-btn"
              onClick={() => (animState === 'sleep' ? dispatch('WAKE_UP') : dispatch('START_SLEEP'))}
            >
              {animState === 'sleep' ? 'Разбудить' : 'Усыпить'}
            </button>
          </div>

          <div className="pet-menu-section">Палитра:</div>
          <div className="pet-theme-picker">
            {Object.values(DEFAULT_THEMES).map((thm) => (
              <button
                key={thm.id}
                className={`pet-btn ${currentTheme.id === thm.id ? 'pet-btn-active' : ''}`}
                style={{ backgroundColor: thm.palette.primary }}
                onClick={() => setCurrentTheme(thm)}
              >
                {thm.name}
              </button>
            ))}
          </div>

          <div className="pet-menu-section">Размер:</div>
          <div className="pet-scale-picker">
            {[0.8, 1.0, 1.25, 1.5].map((s) => (
              <button
                key={s}
                className={`pet-btn ${scale === s ? 'pet-btn-active' : ''}`}
                onClick={() => setScale(s)}
              >
                {Math.round(s * 100)}%
              </button>
            ))}
          </div>

          <div className="pet-menu-actions">
            <button className="pet-btn pet-btn-danger" onClick={handleClose}>
              Закрыть
            </button>
          </div>
        </div>
      )}

      <CharacterRenderer
        expression={expression}
        theme={currentTheme}
        scale={scale}
        isDragging={isDragging}
        tiltDeg={tiltDeg}
        onMouseDown={handleMouseDown}
        onClick={handlePetClick}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(!menuOpen);
        }}
      />

      <div
        className="pet-label"
        onClick={() => setMenuOpen(!menuOpen)}
      >
        Wisp • {animState}
      </div>
    </div>
  );
};
