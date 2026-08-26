import React, { useState, useEffect } from 'react';
import type { SystemInfoDTO } from '../../shared/ipc-contracts';

export const DesktopPet: React.FC = () => {
  const [systemInfo, setSystemInfo] = useState<SystemInfoDTO | null>(null);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [mood, setMood] = useState<string>('Спокоен');
  const [clickCount, setClickCount] = useState<number>(0);

  useEffect(() => {
    if (window.wispAPI?.getSystemInfo) {
      window.wispAPI
        .getSystemInfo()
        .then((info) => setSystemInfo(info))
        .catch((err) => console.error('Failed to get system info:', err));
    }
  }, []);

  const handleMouseEnter = () => {
    // When hovering over the interactive pet, disable click-through
    if (window.wispAPI?.setIgnoreMouseEvents) {
      void window.wispAPI.setIgnoreMouseEvents({ ignore: false });
    }
  };

  const handleMouseLeave = () => {
    // When leaving pet area, re-enable click-through so user can click desktop apps
    if (window.wispAPI?.setIgnoreMouseEvents) {
      void window.wispAPI.setIgnoreMouseEvents({ ignore: true, forward: true });
    }
  };

  const handleClick = () => {
    const nextCount = clickCount + 1;
    setClickCount(nextCount);

    const moods = ['Спокоен', 'Любопытен', 'Радостен', 'Задумчив', 'Игрив'];
    const randomMood = moods[Math.floor(Math.random() * moods.length)] ?? 'Спокоен';
    setMood(randomMood);
  };

  const handleClose = () => {
    if (window.wispAPI?.closeApp) {
      void window.wispAPI.closeApp();
    }
  };

  return (
    <div
      className="pet-container"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {menuOpen && (
        <div className="pet-menu">
          <h4>✨ Wisp Companion (Phase 2)</h4>
          <div className="pet-menu-info">
            <span>ОС: <strong>{systemInfo?.platform || 'linux'}</strong> ({systemInfo?.sessionType || 'x11'})</span>
            <span>Electron: <strong>v{systemInfo?.electronVersion || '-'}</strong></span>
            <span>Режим: <strong>Прозрачный оверлей (Always-On-Top)</strong></span>
            <span>Настроение: <strong>{mood}</strong></span>
            <span>Кликов: <strong>{clickCount}</strong></span>
          </div>
          <div className="pet-menu-actions">
            <button
              className="pet-btn"
              onClick={() => setMood('Счастлив!')}
            >
              Погладить
            </button>
            <button
              className="pet-btn pet-btn-danger"
              onClick={handleClose}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      <div
        className="pet-avatar"
        onClick={handleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(!menuOpen);
        }}
        title="ЛКМ: Взаимодействие | ПКМ: Меню"
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
