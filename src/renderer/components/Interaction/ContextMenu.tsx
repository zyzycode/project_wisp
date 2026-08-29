import React, { useEffect, useRef } from 'react';
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

const ALL_ANIMATION_BUTTONS: { event: AnimationEvent; label: string }[] = [
  { event: 'SETTLE', label: '🌿 Дыхание' },
  { event: 'START_FLOAT', label: '🐾 Ходьба' },
  { event: 'PET', label: '💖 Радость' },
  { event: 'WAVE', label: '🖐️ Привет' },
  { event: 'CELEBRATE', label: '🎉 Праздник' },
  { event: 'THINK', label: '💡 Мысли' },
  { event: 'SPOOK', label: '😲 Испуг' },
  { event: 'BORED', label: '🥱 Скука' },
  { event: 'START_SLEEP', label: '🌙 Сон' },
  { event: 'WAKE_UP', label: '☀️ Подъём' },
  { event: 'SIT', label: '🪑 Сесть' },
  { event: 'LIE_DOWN', label: '🛌 Лечь' },
  { event: 'STAND_UP', label: '🧍 Встать' },
  { event: 'RUN', label: '🏃 Бегать' },
  { event: 'START_DRAG', label: '🪁 Полёт' },
  { event: 'LAND', label: '🛬 Посадка' },
];

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
  return ALL_ANIMATION_BUTTONS.filter(({ event }) =>
    ['SIT', 'LIE_DOWN', 'STAND_UP', 'RUN'].includes(event)
  ).map(({ event, label }) => ({
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
    if (target !== null && !menuElement.contains(target as Node)) onClose();
  };

  ownerDocument.addEventListener('mousedown', handleMouseDown);
  return () => ownerDocument.removeEventListener('mousedown', handleMouseDown);
}

const MENU_MARGIN = 12;
const MENU_WIDTH = 580;
const MENU_MAX_HEIGHT = 556;

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

export const ContextMenu: React.FC<ContextMenuProps> = ({
  isOpen,
  position,
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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const menuElement = menuRef.current;
    if (!menuElement) return undefined;
    return subscribeToOutsideMouseDown(document, menuElement, onClose);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 880;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 580;
  const menuPosition = position === undefined
    ? undefined
    : calculateContextMenuPosition(position, { width: viewportWidth, height: viewportHeight });
  const positionedStyle = menuPosition === undefined ? undefined : {
    left: menuPosition.x,
    top: menuPosition.y,
    right: 'auto',
    bottom: 'auto',
    width: Math.min(MENU_WIDTH, Math.max(0, viewportWidth - MENU_MARGIN * 2)),
  };
  const interactionActions = createInteractionMenuActions({ onPet, onPlay, onFeed, onThink });
  const showDebugPanel = Boolean(debugHudEnabled && debugContent);

  return (
    <div
      ref={menuRef}
      className={`wisp-context-menu ${showDebugPanel ? 'has-debug' : ''}`}
      style={positionedStyle}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="menu-header">
        <div className="menu-header-left">
          <span className="menu-title">✨ Wisp Companion</span>
          <span className="menu-status-pill">
            {TONE_LABELS_RU[tone] ?? tone}
          </span>
        </div>
        <button type="button" className="menu-close-btn" aria-label="Close control panel" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="menu-unified-grid" aria-label="Wisp control panel">
        {/* Column 1: Core Controls & Customization */}
        <div className="menu-column menu-column-controls">
          <div className="menu-section-title">🎮 Действия</div>
          <div className="menu-btn-grid">
            {interactionActions.map((action) => (
              <button key={action.id} className="menu-action-btn" onClick={action.onSelect}>
                {action.label}
              </button>
            ))}
            <button className="menu-action-btn" onClick={onToggleSleep}>
              {isSleeping ? '☀️ Разбудить' : '🌙 Усыпить'}
            </button>
            <button className={`menu-action-btn ${autoWanderEnabled ? 'active' : ''}`} onClick={onToggleWander}>
              {autoWanderEnabled ? '🐾 Прогулка: ВКЛ' : '🛑 Прогулка: ВЫКЛ'}
            </button>
          </div>

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
              100%
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
                📌 Поверх окон: {isAlwaysOnTop ? 'ВКЛ' : 'ВЫКЛ'}
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

          <div className="menu-divider" />
          <button className="menu-quit-btn" onClick={onQuit}>
            🚪 Выйти из приложения
          </button>
        </div>

        {/* Column 2: Animations & Expressions (Consolidated, No Duplication) */}
        <div className="menu-column menu-column-animations">
          {onPlayAnimation ? (
            <>
              <div className="menu-section-title">🎬 Анимации и позы</div>
              <div className="menu-anim-4col-grid">
                {ALL_ANIMATION_BUTTONS.map((item) => (
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

          {onSelectFace ? (
            <>
              <div className="menu-divider" />
              <div className="menu-section-title">🎭 Выражения лица</div>
              <div className="menu-anim-4col-grid">
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
        </div>

        {/* Column 3: Telemetry & Inspector & Logs (when debug is enabled) */}
        {showDebugPanel ? (
          <div className="menu-column menu-column-debug" data-testid="telemetry-panel">
            {debugContent}
          </div>
        ) : null}
      </div>
    </div>
  );
};
