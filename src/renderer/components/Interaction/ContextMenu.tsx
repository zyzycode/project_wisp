import React, { useEffect, useRef, useState } from 'react';
import type { CharacterTheme } from '../../../domain/models/character-visuals';
import { DEFAULT_THEMES } from '../../../domain/models/character-visuals';
import type { SynthesizedEmotionalTone } from '../../../domain/character/types';
import type { AnimationEvent } from '../../../domain/animation/animation-state-machine';
import type { AnimationExpressionHint } from '../../../domain/animation/animation-intent';

export type ContextMenuTab = 'main' | 'debug';

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface ContextMenuProps {
  isOpen: boolean;
  position?: ContextMenuPosition;
  activeTab?: ContextMenuTab;
  tone?: SynthesizedEmotionalTone;
  currentTheme: CharacterTheme;
  scale: number;
  autoWanderEnabled: boolean;
  isSleeping: boolean;
  debugHudEnabled: boolean;
  debugHudVisible?: boolean;
  isAlwaysOnTop?: boolean;
  debugContent?: React.ReactNode;
  currentFace?: AnimationExpressionHint | null;
  onTabChange?: (tab: ContextMenuTab) => void;
  onClose: () => void;
  onPet: () => void;
  onPlay?: () => void;
  onFeed?: () => void;
  onThink: () => void;
  onToggleSleep: () => void;
  onToggleWander: () => void;
  onToggleDebugHud?: () => void;
  onToggleAlwaysOnTop?: () => void;
  onResetPosition?: () => void;
  onPlayAnimation?: (anim: AnimationEvent) => void;
  onSelectFace?: (face: AnimationExpressionHint | null) => void;
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

const POSE_BUTTONS: { event: AnimationEvent; label: string }[] = [
  { event: 'SIT', label: '🪑 Сесть' },
  { event: 'LIE_DOWN', label: '🛌 Лечь' },
  { event: 'STAND_UP', label: '🧍 Встать' },
  { event: 'RUN', label: '🏃 Бегать' },
];

export interface ContextMenuAction {
  id: string;
  label: string;
  onSelect: () => void;
}

export function createInteractionMenuActions(callbacks: {
  onPet: () => void;
  onPlay?: () => void;
  onFeed?: () => void;
  onThink: () => void;
}): ContextMenuAction[] {
  return [
    { id: 'pet', label: '💖 Погладить', onSelect: callbacks.onPet },
    ...(callbacks.onPlay ? [{ id: 'play', label: '🎮 Поиграть', onSelect: callbacks.onPlay }] : []),
    ...(callbacks.onFeed ? [{ id: 'feed', label: '🍪 Покормить', onSelect: callbacks.onFeed }] : []),
    { id: 'think', label: '💡 Подумать', onSelect: callbacks.onThink },
  ];
}

export function createPoseMenuActions(onPlayAnimation: (event: AnimationEvent) => void): ContextMenuAction[] {
  return POSE_BUTTONS.map(({ event, label }) => ({
    id: event,
    label,
    onSelect: () => onPlayAnimation(event),
  }));
}

export function subscribeToOutsideMouseDown(
  ownerDocument: Document,
  menuElement: Pick<HTMLDivElement, 'contains'>,
  onClose: () => void
): () => void {
  const handleMouseDown = (event: MouseEvent): void => {
    const target = event.target;
    if (target instanceof Node && !menuElement.contains(target)) onClose();
  };

  ownerDocument.addEventListener('mousedown', handleMouseDown);
  return () => ownerDocument.removeEventListener('mousedown', handleMouseDown);
}

const MENU_MARGIN = 12;
const MENU_WIDTH = 320;
const MENU_MAX_HEIGHT = 476;

export function calculateContextMenuPosition(
  anchor: ContextMenuPosition,
  viewport: { width: number; height: number }
): ContextMenuPosition {
  const availableWidth = Math.max(0, viewport.width - MENU_MARGIN * 2);
  const availableHeight = Math.max(0, viewport.height - MENU_MARGIN * 2);
  const renderedWidth = Math.min(MENU_WIDTH, availableWidth);
  const renderedHeight = Math.min(MENU_MAX_HEIGHT, availableHeight);

  return {
    x: Math.min(Math.max(MENU_MARGIN, anchor.x), Math.max(MENU_MARGIN, viewport.width - renderedWidth - MENU_MARGIN)),
    y: Math.min(Math.max(MENU_MARGIN, anchor.y), Math.max(MENU_MARGIN, viewport.height - renderedHeight - MENU_MARGIN)),
  };
}

const FACE_BUTTONS: { face: AnimationExpressionHint | null; label: string }[] = [
  { face: null, label: '🔄 Авто' },
  { face: 'happy', label: '😊 Радость' },
  { face: 'sad', label: '😢 Грусть' },
  { face: 'shocked', label: '😲 Шок' },
  { face: 'sleepy', label: '😴 Сон' },
  { face: 'talking', label: '💬 Речь' },
  { face: 'thinking', label: '🤔 Мысли' },
  { face: 'angry', label: '😠 Злость' },
];

export const ContextMenu: React.FC<ContextMenuProps> = ({
  isOpen,
  position,
  activeTab,
  tone = 'neutral',
  currentTheme,
  scale,
  autoWanderEnabled,
  isSleeping,
  debugHudEnabled,
  debugHudVisible = false,
  isAlwaysOnTop = false,
  debugContent,
  currentFace = null,
  onTabChange,
  onClose,
  onPet,
  onPlay,
  onFeed,
  onThink,
  onToggleSleep,
  onToggleWander,
  onToggleDebugHud,
  onToggleAlwaysOnTop,
  onResetPosition,
  onPlayAnimation,
  onSelectFace,
  onSelectTheme,
  onSelectScale,
  onQuit,
}) => {
  const [internalTab, setInternalTab] = useState<ContextMenuTab>('main');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const menuElement = menuRef.current;
    if (!menuElement) return undefined;
    return subscribeToOutsideMouseDown(document, menuElement, onClose);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentTab = activeTab ?? internalTab;
  const menuPosition = position === undefined
    ? undefined
    : calculateContextMenuPosition(position, { width: window.innerWidth, height: window.innerHeight });
  const positionedStyle = menuPosition === undefined ? undefined : {
    left: menuPosition.x,
    top: menuPosition.y,
    right: 'auto',
    bottom: 'auto',
    width: Math.min(MENU_WIDTH, Math.max(0, window.innerWidth - MENU_MARGIN * 2)),
  };
  const interactionActions = createInteractionMenuActions({ onPet, onPlay, onFeed, onThink });

  const handleTabSelect = (tab: ContextMenuTab) => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };

  return (
    <div
      ref={menuRef}
      className="wisp-context-menu"
      style={positionedStyle}
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
              {interactionActions.map((action) => (
                <button key={action.id} className="menu-action-btn" onClick={action.onSelect}>
                  {action.label}
                </button>
              ))}
              <button className="menu-action-btn" onClick={onToggleSleep}>{isSleeping ? '☀️ Разбудить' : '🌙 Усыпить'}</button>
              <button className={`menu-action-btn ${autoWanderEnabled ? 'active' : ''}`} onClick={onToggleWander}>
                {autoWanderEnabled ? '🐾 Прогулка: ВКЛ' : '🛑 Прогулка: ВЫКЛ'}
              </button>
            </div>

            {onPlayAnimation ? (
              <>
                <div className="menu-divider" />
                <div className="menu-section-title">🐾 Быстрые позы</div>
                <div className="menu-anim-btn-grid">
                  {createPoseMenuActions(onPlayAnimation).map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className="menu-anim-btn"
                      onClick={action.onSelect}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {onResetPosition || onToggleAlwaysOnTop || (debugHudEnabled && onToggleDebugHud) ? (
              <>
                <div className="menu-divider" />
                <div className="menu-section-title">🖥️ Окно и инструменты</div>
                <div className="menu-btn-grid">
                  {onResetPosition ? (
                    <button type="button" className="menu-action-btn" onClick={onResetPosition}>
                      🎯 Сбросить позицию
                    </button>
                  ) : null}
                  {onToggleAlwaysOnTop ? (
                    <button
                      type="button"
                      className={`menu-action-btn ${isAlwaysOnTop ? 'active' : ''}`}
                      aria-pressed={isAlwaysOnTop}
                      onClick={onToggleAlwaysOnTop}
                    >
                      📌 Поверх всех окон: {isAlwaysOnTop ? 'ВКЛ' : 'ВЫКЛ'}
                    </button>
                  ) : null}
                  {debugHudEnabled && onToggleDebugHud ? (
                    <button
                      type="button"
                      className={`menu-action-btn ${debugHudVisible ? 'active' : ''}`}
                      aria-pressed={debugHudVisible}
                      onClick={onToggleDebugHud}
                    >
                      🛠️ Debug HUD: {debugHudVisible ? 'ВКЛ' : 'ВЫКЛ'}
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}

            {onSelectFace ? (
              <>
                <div className="menu-divider" />
                <div className="menu-section-title">🎭 Выражения лица</div>
                <div className="menu-anim-btn-grid">
                  {FACE_BUTTONS.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      className={`menu-anim-btn ${currentFace === item.face ? 'active' : ''}`}
                      onClick={() => onSelectFace(item.face)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {onPlayAnimation ? (
              <>
                <div className="menu-divider" />
                <div className="menu-section-title">🎬 Анимации тела</div>
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
