import React from 'react';
import type { SystemInfoDTO } from '../../shared/ipc-contracts';
import type { CharacterTheme } from '../../domain/models/character-visuals';
import { DEFAULT_THEMES } from '../../domain/models/character-visuals';
import type { AnimationState } from '../../domain/animation/animation-state-machine';

export interface PetMenuProps {
  systemInfo: SystemInfoDTO | null;
  animState: AnimationState;
  expression: string;
  isWandering: boolean;
  currentTheme: CharacterTheme;
  scale: number;
  autoWanderEnabled: boolean;
  onToggleAutoWander: () => void;
  onTriggerSleepToggle: () => void;
  onSelectTheme: (theme: CharacterTheme) => void;
  onSelectScale: (scale: number) => void;
  onClose: () => void;
}

export const PetMenu: React.FC<PetMenuProps> = ({
  systemInfo,
  animState,
  expression,
  isWandering,
  currentTheme,
  scale,
  autoWanderEnabled,
  onToggleAutoWander,
  onTriggerSleepToggle,
  onSelectTheme,
  onSelectScale,
  onClose,
}) => {
  return (
    <div className="pet-menu" onClick={(e) => e.stopPropagation()}>
      <h4>✨ Wisp Companion (Phase 6)</h4>
      <div className="pet-menu-info">
        <span>ОС: <strong>{systemInfo?.platform || 'linux'}</strong> ({systemInfo?.sessionType || 'x11'})</span>
        <span>Поведение: <strong>{isWandering ? 'Гуляет 🐾' : animState}</strong></span>
        <span>Эмоция: <strong>{expression}</strong></span>
        <span>Тема: <strong>{currentTheme.name}</strong></span>
        <span>Масштаб: <strong>{Math.round(scale * 100)}%</strong></span>
      </div>

      <div className="pet-menu-section">Автономность:</div>
      <div className="pet-theme-picker">
        <button
          className={`pet-btn ${autoWanderEnabled ? 'pet-btn-active' : ''}`}
          onClick={onToggleAutoWander}
        >
          {autoWanderEnabled ? '🐾 Авто-прогулки: ВКЛ' : '🛑 Авто-прогулки: ВЫКЛ'}
        </button>
        <button
          className="pet-btn"
          onClick={onTriggerSleepToggle}
        >
          {animState === 'sleep' ? '☀️ Разбудить' : '🌙 Усыпить'}
        </button>
      </div>

      <div className="pet-menu-section">Палитра:</div>
      <div className="pet-theme-picker">
        {Object.values(DEFAULT_THEMES).map((thm) => (
          <button
            key={thm.id}
            className={`pet-btn ${currentTheme.id === thm.id ? 'pet-btn-active' : ''}`}
            style={{ backgroundColor: thm.palette.primary }}
            onClick={() => onSelectTheme(thm)}
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
            onClick={() => onSelectScale(s)}
          >
            {Math.round(s * 100)}%
          </button>
        ))}
      </div>

      <div className="pet-menu-actions">
        <button className="pet-btn pet-btn-danger" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
};
