import React, { useState, useEffect, useRef } from 'react';
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
  { event: 'SETTLE', label: 'body_idle' },
  { event: 'START_FLOAT', label: 'body_walk' },
  { event: 'PET', label: 'body_petting' },
  { event: 'WAVE', label: 'body_wave' },
  { event: 'CELEBRATE', label: 'body_celebrate' },
  { event: 'THINK', label: 'body_thinking' },
  { event: 'SPOOK', label: 'body_scared' },
  { event: 'BORED', label: 'body_bored' },
  { event: 'START_SLEEP', label: 'body_sleep_trans' },
  { event: 'WAKE_UP', label: 'body_land' },
  { event: 'SIT', label: 'body_sit' },
  { event: 'LIE_DOWN', label: 'body_lie' },
  { event: 'STAND_UP', label: 'body_stand_up' },
  { event: 'RUN', label: 'body_run' },
  { event: 'JUMP', label: 'body_jump' },
  { event: 'FALL', label: 'body_fall' },
  { event: 'CLIMB_WALL', label: 'body_climb_wall' },
  { event: 'HANG_CEILING', label: 'body_ceiling_hang' },
  { event: 'START_DRAG', label: 'body_dragged' },
  { event: 'LAND', label: 'body_land' },
];

const FACE_BUTTONS: { face: AnimationExpressionHint | null; label: string }[] = [
  { face: null, label: 'auto' },
  { face: 'happy', label: 'face_happy' },
  { face: 'sad', label: 'face_sad' },
  { face: 'shocked', label: 'face_shocked' },
  { face: 'sleepy', label: 'face_sleep' },
  { face: 'talking', label: 'face_talking' },
  { face: 'thinking', label: 'face_thinking' },
  { face: 'angry', label: 'face_angry' },
  { face: 'pout', label: 'face_pout' },
  { face: 'winking', label: 'face_winking' },
  { face: 'curious', label: 'face_curious' },
  { face: 'dizzy', label: 'face_dizzy' },
  { face: 'flirty', label: 'face_flirty' },
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
    { id: 'pet', label: 'body_petting (Погладить)', onSelect: callbacks.onPet },
    ...(callbacks.onPlay ? [{ id: 'play', label: 'body_celebrate (Поиграть)', onSelect: callbacks.onPlay }] : []),
    ...(callbacks.onFeed ? [{ id: 'feed', label: 'prop_heart (Покормить)', onSelect: callbacks.onFeed }] : []),
    { id: 'think', label: 'body_thinking (Подумать)', onSelect: callbacks.onThink },
  ];
}

export function createPoseMenuActions(onPlayAnimation: (event: AnimationEvent) => void): ContextMenuAction[] {
  return ALL_ANIMATION_BUTTONS.filter(({ event }) =>
    ['SIT', 'LIE_DOWN', 'STAND_UP', 'RUN', 'JUMP', 'FALL', 'CLIMB_WALL', 'HANG_CEILING'].includes(event)
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
const MENU_WIDTH = 340;
const MENU_MAX_HEIGHT = 500;

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
    const cleanupOutside = subscribeToOutsideMouseDown(document, menuElement, onClose);
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cleanupOutside();
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentTab = activeTab ?? internalTab;

  const handleTabSelect = (tab: ContextMenuTab) => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };

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

  return (
    <div
      ref={menuRef}
      className={`wisp-context-menu ${currentTab === 'debug' ? 'tab-debug' : 'tab-main'}`}
      style={positionedStyle}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      role="dialog"
      aria-label="Wisp Companion Menu"
    >
      <div className="menu-header">
        <div className="menu-header-left">
          <span className="menu-title">Wisp Companion</span>
          <span className="menu-status-pill">
            {TONE_LABELS_RU[tone] ?? tone}
          </span>
        </div>
        <button type="button" className="menu-close-btn" aria-label="Close control panel" onClick={onClose}>
          ✕
        </button>
      </div>

      {debugHudEnabled ? (
        <div className="menu-tabs" role="tablist" aria-label="Menu sections">
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'main'}
            className={`menu-tab-btn ${currentTab === 'main' ? 'active' : ''}`}
            onClick={() => handleTabSelect('main')}
          >
            Главное
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'debug'}
            className={`menu-tab-btn ${currentTab === 'debug' ? 'active' : ''}`}
            onClick={() => handleTabSelect('debug')}
          >
            Debug
          </button>
        </div>
      ) : null}

      {currentTab === 'debug' && debugHudEnabled ? (
        <div className="telemetry-panel" role="tabpanel" aria-label="Debug telemetry">
          {debugContent ?? <div className="debug-log-empty">Нет данных отладки</div>}
        </div>
      ) : (
        <div className="menu-scroll-body" role="tabpanel" aria-label="Main controls">
          {/* Actions */}
          <div className="menu-section">
            <div className="menu-section-title">Действия</div>
            <div className="menu-btn-grid">
              {interactionActions.map((action) => (
                <button key={action.id} type="button" className="menu-action-btn" onClick={action.onSelect}>
                  {action.label}
                </button>
              ))}
              <button type="button" className="menu-action-btn" onClick={onToggleSleep}>
                {isSleeping ? 'body_land (Разбудить)' : 'body_sleep (Усыпить)'}
              </button>
              <button
                type="button"
                className={`menu-action-btn ${autoWanderEnabled ? 'active' : ''}`}
                onClick={onToggleWander}
              >
                {autoWanderEnabled ? 'body_walk (Прогулка: ВКЛ)' : 'body_idle (Прогулка: ВЫКЛ)'}
              </button>
            </div>
          </div>

          {/* Animations & Poses */}
          {onPlayAnimation ? (
            <div className="menu-section">
              <div className="menu-divider" />
              <div className="menu-section-title">Анимации и позы</div>
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
            </div>
          ) : null}

          {/* Face Expressions */}
          {onSelectFace ? (
            <div className="menu-section">
              <div className="menu-divider" />
              <div className="menu-section-title">Выражения лица</div>
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
            </div>
          ) : null}

          {/* Themes */}
          <div className="menu-section">
            <div className="menu-divider" />
            <div className="menu-section-title">Темы оформления</div>
            <div className="menu-theme-grid">
              {Object.values(DEFAULT_THEMES).map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className={`menu-theme-btn ${currentTheme.id === theme.id ? 'active' : ''}`}
                  style={{ background: theme.palette.primary }}
                  onClick={() => onSelectTheme(theme)}
                >
                  {theme.name}
                </button>
              ))}
            </div>
          </div>

          {/* Scale */}
          <div className="menu-section">
            <div className="menu-divider" />
            <div className="menu-section-title">Размер: {Math.round(scale * 100)}%</div>
            <div className="menu-scale-controls">
              <button
                type="button"
                className="menu-scale-btn"
                disabled={scale <= 0.6}
                onClick={() => onSelectScale(Math.max(0.5, Number((scale - 0.1).toFixed(1))))}
              >
                - Уменьшить
              </button>
              <button
                type="button"
                className={`menu-scale-btn ${scale === 1.0 ? 'active' : ''}`}
                onClick={() => onSelectScale(1.0)}
              >
                100%
              </button>
              <button
                type="button"
                className="menu-scale-btn"
                disabled={scale >= 2.0}
                onClick={() => onSelectScale(Math.min(2.0, Number((scale + 0.1).toFixed(1))))}
              >
                + Увеличить
              </button>
            </div>
          </div>

          {/* Window & Tools */}
          {onResetPosition || onToggleAlwaysOnTop || (debugHudEnabled && onToggleDebugHud) ? (
            <div className="menu-section">
              <div className="menu-divider" />
              <div className="menu-section-title">Окно и инструменты</div>
              <div className="menu-btn-grid">
                {onResetPosition ? (
                  <button type="button" className="menu-action-btn" onClick={onResetPosition}>
                    Сбросить позицию
                  </button>
                ) : null}
                {onToggleAlwaysOnTop ? (
                  <button
                    type="button"
                    className={`menu-action-btn ${isAlwaysOnTop ? 'active' : ''}`}
                    aria-pressed={isAlwaysOnTop}
                    onClick={onToggleAlwaysOnTop}
                  >
                    Поверх окон: {isAlwaysOnTop ? 'ВКЛ' : 'ВЫКЛ'}
                  </button>
                ) : null}
                {debugHudEnabled && onToggleDebugHud ? (
                  <button
                    type="button"
                    className={`menu-action-btn ${debugHudVisible ? 'active' : ''}`}
                    aria-pressed={debugHudVisible}
                    onClick={onToggleDebugHud}
                  >
                    Debug HUD: {debugHudVisible ? 'ВКЛ' : 'ВЫКЛ'}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Quit */}
          <div className="menu-section">
            <div className="menu-divider" />
            <button type="button" className="menu-quit-btn" onClick={onQuit}>
              Выйти из приложения
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
