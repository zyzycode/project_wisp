import React from 'react';
import type { CharacterTheme } from '../../../domain/models/character-visuals';
import { DEFAULT_THEMES } from '../../../domain/models/character-visuals';
import type { SynthesizedEmotionalTone } from '../../../domain/character/types';

export interface ContextMenuProps {
  isOpen: boolean;
  tone?: SynthesizedEmotionalTone;
  currentTheme: CharacterTheme;
  scale: number;
  autoWanderEnabled: boolean;
  isSleeping: boolean;
  debugHudEnabled: boolean;
  debugContent?: React.ReactNode;
  onClose: () => void;
  onPet: () => void;
  onThink: () => void;
  onToggleSleep: () => void;
  onToggleWander: () => void;
  onSelectTheme: (theme: CharacterTheme) => void;
  onSelectScale: (scale: number) => void;
  onQuit: () => void;
}

const TONE_LABELS_RU: Record<SynthesizedEmotionalTone, string> = {
  shy: 'Скромное',
  sleepy: 'Сонное',
  playful: 'Игривое',
  curious: 'Любопытное',
  affectionate: 'Нежное',
  flustered: 'Смущённое',
  neutral: 'Спокойное',
};

export const ContextMenu: React.FC<ContextMenuProps> = ({
  isOpen,
  tone = 'neutral',
  currentTheme,
  scale,
  autoWanderEnabled,
  isSleeping,
  debugHudEnabled,
  debugContent,
  onClose,
  onPet,
  onThink,
  onToggleSleep,
  onToggleWander,
  onSelectTheme,
  onSelectScale,
  onQuit,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="wisp-context-menu"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="menu-header">
        <div className="menu-title">✨ Wisp Companion</div>
        <button type="button" className="menu-close-btn" aria-label="Close control panel" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="menu-canvas" aria-label="Wisp control panel">
        <div className="menu-status-badge">
          <span>Настроение: <strong>{TONE_LABELS_RU[tone] ?? tone}</strong></span>
        </div>

        <div className="menu-section-title">🎮 Действия</div>
        <div className="menu-btn-grid">
          <button className="menu-action-btn" onClick={onPet}>💖 Погладить</button>
          <button className="menu-action-btn" onClick={onThink}>💡 Подумать</button>
          <button className="menu-action-btn" onClick={onToggleSleep}>{isSleeping ? '☀️ Разбудить' : '🌙 Усыпить'}</button>
          <button className={`menu-action-btn ${autoWanderEnabled ? 'active' : ''}`} onClick={onToggleWander}>
            {autoWanderEnabled ? '🐾 Прогулка: ВКЛ' : '🛑 Прогулка: ВЫКЛ'}
          </button>
        </div>

        <div className="menu-divider" />
        <div className="menu-section-title">🎨 Внешний вид</div>
        <div className="menu-theme-grid">
          {(Object.values(DEFAULT_THEMES) as CharacterTheme[]).map((thm) => (
            <button key={thm.id} className={`menu-theme-btn ${currentTheme.id === thm.id ? 'active' : ''}`} style={{ borderLeftColor: thm.palette.primary }} onClick={() => onSelectTheme(thm)}>
              {thm.name}
            </button>
          ))}
        </div>
        <div className="menu-section-title">Размер</div>
        <div className="menu-scale-grid">
          {[0.8, 1.0, 1.25, 1.5].map((s) => (
            <button key={s} className={`menu-scale-btn ${scale === s ? 'active' : ''}`} onClick={() => onSelectScale(s)}>{Math.round(s * 100)}%</button>
          ))}
        </div>

        {debugHudEnabled && debugContent ? (
          <>
            <div className="menu-divider" />
            <div className="menu-section-title">🛠️ Debug</div>
            {debugContent}
          </>
        ) : null}

        <div className="menu-divider" />
        <button className="menu-quit-btn" onClick={onQuit}>✕ Закрыть Wisp</button>
      </div>
    </div>
  );
};
