import React, { useState, useEffect, useRef } from 'react';
import type { CharacterTheme } from '../../../domain/models/character-visuals';
import { DEFAULT_THEMES } from '../../../domain/models/character-visuals';
import type { SynthesizedEmotionalTone } from '../../../domain/character/types';

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
  quietMode?: boolean;
  onToggleQuietMode?: () => void;
  isSleeping: boolean;
  debugHudEnabled: boolean;
  debugHudVisible?: boolean;
  isAlwaysOnTop?: boolean;
  debugContent?: React.ReactNode;
  previewContent?: React.ReactNode;
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
    { id: 'pet', label: 'Погладить', onSelect: callbacks.onPet },
    ...(callbacks.onPlay ? [{ id: 'play', label: 'Поиграть', onSelect: callbacks.onPlay }] : []),
    ...(callbacks.onFeed ? [{ id: 'feed', label: 'Покормить', onSelect: callbacks.onFeed }] : []),
    { id: 'think', label: 'Подумать', onSelect: callbacks.onThink },
  ];
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
  quietMode = false,
  onToggleQuietMode,
  isSleeping,
  debugHudEnabled,
  debugHudVisible = false,
  isAlwaysOnTop = false,
  debugContent,
  previewContent,
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
      data-wisp-interactive="true"
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

      <div className="menu-section" role="status">
        Автономность приостановлена, пока открыто меню.
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
          {previewContent}
          {/* Actions */}
          <div className="menu-section">
            <div className="menu-section-title">Действия</div>
            <div className="menu-btn-grid">
              {interactionActions.map((action) => (
                <button key={action.id} type="button" className="menu-action-btn" onClick={action.onSelect}>
                  {action.label}
                </button>
              ))}
              <button type="button" className={`menu-action-btn ${quietMode ? 'active' : ''}`} onClick={onToggleQuietMode}>
                {quietMode ? 'Тихий режим: ВКЛ' : 'Тихий режим: ВЫКЛ'}
              </button>
              <button type="button" className="menu-action-btn" onClick={onToggleSleep}>
                {isSleeping ? 'Разбудить' : 'Усыпить'}
              </button>
              <button
                type="button"
                className={`menu-action-btn ${autoWanderEnabled ? 'active' : ''}`}
                onClick={onToggleWander}
              >
                {autoWanderEnabled ? 'После закрытия: автономность ВКЛ' : 'После закрытия: автономность ВЫКЛ'}
              </button>
            </div>
          </div>

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
