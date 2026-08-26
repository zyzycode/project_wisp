import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { SystemInfoDTO, PetPositionDTO } from '../../shared/ipc-contracts';
import { calculateDragInertia } from '../../domain/models/position';
import type {
  CharacterExpression,
  CharacterTheme,
} from '../../domain/models/character-visuals';
import { DEFAULT_THEMES } from '../../domain/models/character-visuals';
import { CharacterRenderer } from './Character/CharacterRenderer';

export const DesktopPet: React.FC = () => {
  const [systemInfo, setSystemInfo] = useState<SystemInfoDTO | null>(null);
  const [position, setPosition] = useState<PetPositionDTO>({ x: 300, y: 300 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [tiltDeg, setTiltDeg] = useState<number>(0);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [expression, setExpression] = useState<CharacterExpression>('idle');
  const [currentTheme, setCurrentTheme] = useState<CharacterTheme>(
    DEFAULT_THEMES.cosmic ?? Object.values(DEFAULT_THEMES)[0]!
  );
  const [scale, setScale] = useState<number>(1.0);

  // Drag calculation references
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

  // Fetch initial position & system info
  useEffect(() => {
    if (window.wispAPI?.getSystemInfo) {
      window.wispAPI
        .getSystemInfo()
        .then((info) => setSystemInfo(info))
        .catch((err) => console.error('Failed to get system info:', err));
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
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (window.wispAPI?.setIgnoreMouseEvents) {
      void window.wispAPI.setIgnoreMouseEvents({ ignore: false });
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!isDragging && window.wispAPI?.setIgnoreMouseEvents) {
      void window.wispAPI.setIgnoreMouseEvents({ ignore: true, forward: true });
    }
  }, [isDragging]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left click only for dragging

    setIsDragging(true);
    setExpression('flying');

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
      setIsDragging(false);
      setTiltDeg(0);
      setExpression('happy');

      setTimeout(() => {
        setExpression('idle');
      }, 2000);

      if (window.wispAPI?.setIgnoreMouseEvents) {
        setTimeout(() => {
          void window.wispAPI.setIgnoreMouseEvents({ ignore: true, forward: true });
        }, 100);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handlePetClick = () => {
    if (isDragging) return;
    const expressions: CharacterExpression[] = ['happy', 'curious', 'surprised', 'idle', 'sleepy'];
    const nextExpr = expressions[Math.floor(Math.random() * expressions.length)] ?? 'happy';
    setExpression(nextExpr);
  };

  const handleClose = () => {
    if (window.wispAPI?.closeApp) {
      void window.wispAPI.closeApp();
    }
  };

  return (
    <div
      className={`pet-container ${isDragging ? 'is-dragging' : ''}`}
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {menuOpen && (
        <div className="pet-menu" onClick={(e) => e.stopPropagation()}>
          <h4>✨ Wisp Companion (Phase 4)</h4>
          <div className="pet-menu-info">
            <span>ОС: <strong>{systemInfo?.platform || 'linux'}</strong> ({systemInfo?.sessionType || 'x11'})</span>
            <span>Эмоция: <strong>{expression}</strong></span>
            <span>Тема: <strong>{currentTheme.name}</strong></span>
            <span>Масштаб: <strong>{Math.round(scale * 100)}%</strong></span>
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
            <button className="pet-btn" onClick={() => setExpression('happy')}>
              Погладить
            </button>
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
        Wisp • {expression}
      </div>
    </div>
  );
};
