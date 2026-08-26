import React from 'react';
import type { PetAffectionState } from '../../../domain/interaction/pet-interaction';
import type { CharacterTheme } from '../../../domain/models/character-visuals';
import { DEFAULT_THEMES } from '../../../domain/models/character-visuals';

export interface ContextMenuProps {
  isOpen: boolean;
  affection: PetAffectionState;
  currentTheme: CharacterTheme;
  scale: number;
  autoWanderEnabled: boolean;
  isSleeping: boolean;
  onClose: () => void;
  onPet: () => void;
  onSpook: () => void;
  onToggleSleep: () => void;
  onToggleWander: () => void;
  onSelectTheme: (theme: CharacterTheme) => void;
  onSelectScale: (scale: number) => void;
  onQuit: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  isOpen,
  affection,
  currentTheme,
  scale,
  autoWanderEnabled,
  isSleeping,
  onClose,
  onPet,
  onSpook,
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
        <button className="menu-close-btn" onClick={onClose}>
          ✕
        </button>
      </div>

      {/* Affection Status */}
      <div className="menu-affection-bar">
        <div className="affection-label">
          <span>Настроение: <strong>{affection.mood}</strong></span>
          <span>❤️ {affection.affectionScore}%</span>
        </div>
        <div className="affection-progress-bg">
          <div
            className="affection-progress-fill"
            style={{ width: `${affection.affectionScore}%` }}
          />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="menu-section-title">Взаимодействие</div>
      <div className="menu-btn-grid">
        <button className="menu-action-btn" onClick={onPet}>
          💖 Погладить
        </button>
        <button className="menu-action-btn" onClick={onSpook}>
          👻 Напугать
        </button>
        <button className="menu-action-btn" onClick={onToggleSleep}>
          {isSleeping ? '☀️ Разбудить' : '🌙 Усыпить'}
        </button>
        <button
          className={`menu-action-btn ${autoWanderEnabled ? 'active' : ''}`}
          onClick={onToggleWander}
        >
          {autoWanderEnabled ? '🐾 Прогулка: ВКЛ' : '🛑 Прогулка: ВЫКЛ'}
        </button>
      </div>

      {/* Theme Picker */}
      <div className="menu-section-title">Тема оформления</div>
      <div className="menu-theme-grid">
        {(Object.values(DEFAULT_THEMES) as CharacterTheme[]).map((thm) => (
          <button
            key={thm.id}
            className={`menu-theme-btn ${currentTheme.id === thm.id ? 'active' : ''}`}
            style={{ borderLeftColor: thm.palette.primary }}
            onClick={() => onSelectTheme(thm)}
          >
            {thm.name}
          </button>
        ))}
      </div>

      {/* Scale Picker */}
      <div className="menu-section-title">Размер</div>
      <div className="menu-scale-grid">
        {[0.8, 1.0, 1.25, 1.5].map((s) => (
          <button
            key={s}
            className={`menu-scale-btn ${scale === s ? 'active' : ''}`}
            onClick={() => onSelectScale(s)}
          >
            {Math.round(s * 100)}%
          </button>
        ))}
      </div>

      <div className="menu-divider" />

      {/* Quit Button */}
      <button className="menu-quit-btn" onClick={onQuit}>
        Закрыть Wisp
      </button>
    </div>
  );
};
