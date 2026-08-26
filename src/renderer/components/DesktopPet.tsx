import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { SystemInfoDTO, PetPositionDTO } from '../../shared/ipc-contracts';
import { calculateDragInertia } from '../../domain/models/position';

export const DesktopPet: React.FC = () => {
  const [systemInfo, setSystemInfo] = useState<SystemInfoDTO | null>(null);
  const [position, setPosition] = useState<PetPositionDTO>({ x: 300, y: 300 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [tiltDeg, setTiltDeg] = useState<number>(0);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [mood, setMood] = useState<string>('Спокоен');

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
    if (e.button !== 0) return; // Only Left Click for drag

    setIsDragging(true);
    setMood('Летим!');

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

  // Global mousemove and mouseup during drag
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

      // Optimistic UI update + Main process clamp
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
      setMood('Приземлился');

      if (window.wispAPI?.setIgnoreMouseEvents) {
        // Delay to ensure click-through returns smoothly after drag release
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
    const moods = ['Спокоен', 'Любопытен', 'Радостен', 'Задумчив', 'Игрив'];
    const nextMood = moods[Math.floor(Math.random() * moods.length)] ?? 'Спокоен';
    setMood(nextMood);
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
          <h4>✨ Wisp Companion (Phase 3)</h4>
          <div className="pet-menu-info">
            <span>ОС: <strong>{systemInfo?.platform || 'linux'}</strong> ({systemInfo?.sessionType || 'x11'})</span>
            <span>Позиция: <strong>X: {position.x}, Y: {position.y}</strong></span>
            <span>Настроение: <strong>{mood}</strong></span>
            <span>Перетаскивание: <strong>Зажмите ЛКМ и тяните</strong></span>
          </div>
          <div className="pet-menu-actions">
            <button className="pet-btn" onClick={() => setMood('Счастлив!')}>
              Погладить
            </button>
            <button className="pet-btn pet-btn-danger" onClick={handleClose}>
              Закрыть
            </button>
          </div>
        </div>
      )}

      <div
        className="pet-avatar"
        onMouseDown={handleMouseDown}
        onClick={handlePetClick}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(!menuOpen);
        }}
        style={{
          transform: `rotate(${tiltDeg}deg) scale(${isDragging ? 1.05 : 1})`,
        }}
        title="Зажмите ЛКМ для перемещения | ПКМ для меню"
      >
        <div className="pet-face">
          <div className="pet-eye" />
          <div className="pet-eye" />
        </div>
        <div className="pet-mouth" />
      </div>

      <div
        className="pet-label"
        onClick={() => setMenuOpen(!menuOpen)}
      >
        Wisp • {mood}
      </div>
    </div>
  );
};
