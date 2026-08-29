import React, { useState } from 'react';
import type { CharacterTheme } from '../../../domain/models/character-visuals';
import { DEFAULT_THEMES } from '../../../domain/models/character-visuals';
import type { SynthesizedEmotionalTone } from '../../../domain/character/types';
import type { AnimationEvent } from '../../../domain/animation/animation-state-machine';

export type ContextMenuTab = 'main' | 'debug';

export interface ContextMenuProps {
  isOpen: boolean;
  activeTab?: ContextMenuTab;
  tone?: SynthesizedEmotionalTone;
  currentTheme: CharacterTheme;
  scale: number;
  autoWanderEnabled: boolean;
  isSleeping: boolean;
  debugHudEnabled: boolean;
  debugContent?: React.ReactNode;
  onTabChange?: (tab: ContextMenuTab) => void;
  onClose: () => void;
  onPet: () => void;
  onThink: () => void;
  onToggleSleep: () => void;
  onToggleWander: () => void;
  onPlayAnimation?: (anim: AnimationEvent) => void;
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

const ANIMATION_BUTTONS: { event: AnimationEvent; label: string }[] = [
  { event: 'SETTLE', label: '🌿 Дыхание' },
  { event: 'START_FLOAT', label: '🐾 Ходьба' },
  { event: 'PET', label: '💖 Радость' },
  { event: 'WAVE', label: '👋 Приветствие' },
  { event: 'CELEBRATE', label: '🎉 Праздник' },
  { event: 'THINK', label: '💡 Мысли' },
  { event: 'SPOOK', label: '😲 Испуг' },
  { event: 'BORED', label: '🥱 Скука' },
  { event: 'START_SLEEP', label: '🌙 Сон' },
  { event: 'WAKE_UP', label: '☀️ Подъём' },
  { event: 'START_DRAG', label: '🪁 Полёт' },
  { event: 'LAND', label: '🛫 Посадка' },
];

export const ContextMenu: React.FC<ContextMenuProps> = ({
  isOpen,
  activeTab,
  tone = 'neutral',
  currentTheme,
  scale,
  autoWanderEnabled,
  isSleeping,
  debugHudEnabled,
  debugContent,
  onTabChange,
  onClose,
  onPet,
  onThink,
  onToggleSleep,
  onToggleWander,
  onPlayAnimation,
  onSelectTheme,
  onSelectScale,
  onQuit,
}) => {
  const [internalTab, setInternalTab] = useState<ContextMenuTab>('main');
  if (!isOpen) return null;

  const currentTab = activeTab ?? internalTab;

  const handleTabSelect = (tab: ContextMenuTab) => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };

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

      {debugHudEnabled && debugContent ? (
        <div className="menu-tab-bar" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'main'}
            className={`menu-tab-btn ${currentTab === 'main' ? 'active' : ''}`}
            onClick={() => handleTabSelect('main')}
          >
            ✨ Меню
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'debug'}
            className={`menu-tab-btn ${currentTab === 'debug' ? 'active' : ''}`}
            onClick={() => handleTabSelect('debug')}
          >
            🛠️ Debug
          </button>
        </div>
      ) : null}

      <div className="menu-canvas" aria-label="Wisp control panel">
        {currentTab === 'debug' && debugHudEnabled && debugContent ? (
          <div className="menu-debug-pane">
            <div className="menu-section-title">🛠️ Debug</div>
            {debugContent}
          </div>
        ) : (
          <div className="menu-main-pane">
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

            {onPlayAnimation ? (
              <>
                <div className="menu-divider" />
                <div className="menu-section-title">🎬 Анимации</div>
                <div className="menu-anim-btn-grid">
                  {ANIMATION_BUTTONS.map((item) => (
                    <button
                      key={item.event}
                      type="button"
                      className="menu-anim-btn"
                      onClick={() => onPlayAnimation(item.event)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            <div className="menu-divider" />
            <div className="menu-section-title">🎨 Темы оформления</div>
            <div className="menu-theme-grid">
              {Object.values(DEFAULT_THEMES).map((theme) => (
                <button
                  key={theme.id}
                  className={`menu-theme-btn ${currentTheme.id === theme.id ? 'active' : ''}`}
                  style={{ background: theme.palette.primary }}
                  onClick={() => onSelectTheme(theme)}
                >
                  {theme.name}
                </button>
              ))}
            </div>

            <div className="menu-divider" />
            <div className="menu-section-title">🔍 Размер: {Math.round(scale * 100)}%</div>
            <div className="menu-scale-controls">
              <button
                className="menu-scale-btn"
                disabled={scale <= 0.6}
                onClick={() => onSelectScale(Math.max(0.5, Number((scale - 0.1).toFixed(1))))}
              >
                - Уменьшить
              </button>
              <button
                className="menu-scale-btn"
                onClick={() => onSelectScale(1.0)}
              >
                Сброс (100%)
              </button>
              <button
                className="menu-scale-btn"
                disabled={scale >= 2.0}
                onClick={() => onSelectScale(Math.min(2.0, Number((scale + 0.1).toFixed(1))))}
              >
                + Увеличить
              </button>
            </div>

            <div className="menu-divider" />
            <button className="menu-quit-btn" onClick={onQuit}>
              🚪 Выйти из приложения
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
