import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { SynthesizedEmotionalTone } from '../../../domain/character/types';
import type { BrainStateDTO } from '../../../shared/ipc-contracts';

const MENU_TABS = [
  { id: 'main', label: 'Главное' },
  { id: 'settings', label: 'Настройки' },
] as const;
type ContextMenuPage = (typeof MENU_TABS)[number]['id'];

export interface ContextMenuProps {
  isOpen: boolean;
  externalWindowSupport?: BrainStateDTO['externalWindowSupport'];
  tone?: SynthesizedEmotionalTone;
  autoWanderEnabled: boolean;
  quietMode?: boolean;
  onToggleQuietMode?: () => void;
  isSleeping: boolean;
  debugHudEnabled: boolean;
  debugHudVisible?: boolean;
  isAlwaysOnTop?: boolean;
  debugContent?: ReactNode;
  previewContent?: ReactNode;
  aiConnectionContent?: ReactNode;
  observationContent?: ReactNode;
  voiceContent?: ReactNode;
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

const SUPPORT_LABELS: Record<NonNullable<BrainStateDTO['externalWindowSupport']>, string> = {
  available: 'Опоры на окнах доступны',
  initializing: 'Проверяем доступность окон…',
  unsupported: 'Опоры на окнах не поддерживаются — используются границы экрана',
  unavailable: 'Окна недоступны — используются границы экрана',
};

export interface ContextMenuAction {
  id: string;
  label: string;
  onSelect: () => void;
}

export function createInteractionMenuActions(callbacks: Pick<ContextMenuProps, 'onPet' | 'onPlay' | 'onFeed' | 'onThink'>): ContextMenuAction[] {
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
  onClose: () => void,
): () => void {
  const handleMouseDown = (event: MouseEvent): void => {
    if (event.target !== null && !menuElement.contains(event.target as Node)) onClose();
  };

  ownerDocument.addEventListener('mousedown', handleMouseDown);
  return () => ownerDocument.removeEventListener('mousedown', handleMouseDown);
}

function keepTabFocus(event: ReactKeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Tab') return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button:enabled, input:enabled, select:enabled, textarea:enabled, a[href], [tabindex="0"]',
  )).filter(control => control.tabIndex >= 0 && control.getClientRects().length > 0);
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;
  const active = event.currentTarget.ownerDocument.activeElement;
  const edge = event.shiftKey ? first : last;
  if (active === edge || active?.getAttribute('tabindex') === '-1') {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

function MenuToggle({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle?: () => void }) {
  return <button type="button" className="menu-action-btn menu-toggle" aria-pressed={enabled} onClick={onToggle} disabled={!onToggle}>
    <span>{label}</span>
    <span className="menu-toggle-state" aria-hidden="true">{enabled ? 'Вкл' : 'Выкл'}</span>
  </button>;
}

export function ContextMenu({ isOpen, ...props }: ContextMenuProps) {
  return isOpen ? <OpenContextMenu {...props} /> : null;
}

function OpenContextMenu({
  externalWindowSupport, tone = 'neutral', autoWanderEnabled,
  quietMode = false, onToggleQuietMode, isSleeping, debugHudEnabled, debugHudVisible = false,
  isAlwaysOnTop = false, debugContent, previewContent, aiConnectionContent, observationContent, voiceContent,
  onClose, onPet, onPlay, onFeed, onThink, onToggleSleep, onToggleWander, onToggleDebugHud,
  onToggleAlwaysOnTop, onResetPosition, onQuit,
}: Omit<ContextMenuProps, 'isOpen'>) {
  const [page, setPage] = useState<ContextMenuPage>('main');
  const titleId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const previous = menuRef.current?.ownerDocument.activeElement;
    titleRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
  }, [page]);

  useEffect(() => {
    const menuElement = menuRef.current;
    if (!menuElement) return;
    const owner = menuElement.ownerDocument;
    const cleanup = subscribeToOutsideMouseDown(owner, menuElement, onClose);
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
    };
    owner.addEventListener('keydown', handleKeyDown);
    return () => {
      cleanup();
      owner.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const moveTabFocus = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    let next: ContextMenuPage;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        next = page === 'main' ? 'settings' : 'main';
        break;
      case 'Home':
        next = 'main';
        break;
      case 'End':
        next = 'settings';
        break;
      default:
        return;
    }
    event.preventDefault();
    setPage(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-menu-tab="${next}"]`)?.focus();
  };

  return (
    <div ref={menuRef} className="wisp-context-menu" data-wisp-interactive="true" data-menu-page={page}
      onClick={event => event.stopPropagation()} onKeyDown={keepTabFocus}
      onContextMenu={event => event.preventDefault()} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="menu-header">
        <h2 ref={titleRef} id={titleId} className="menu-title" tabIndex={-1}>Wisp</h2>
        <span className="menu-status-pill">{TONE_LABELS_RU[tone] ?? tone}</span>
        <button type="button" className="menu-close-btn" aria-label="Закрыть меню" onClick={onClose}>✕</button>
      </header>

      <div className="menu-tabs" role="tablist" aria-label="Разделы меню" onKeyDown={moveTabFocus}>
        {MENU_TABS.map(tab => (
          <button key={tab.id} type="button" className="menu-tab-btn" role="tab"
            id={`${titleId}-tab-${tab.id}`} data-menu-tab={tab.id}
            aria-controls={`${titleId}-panel-${tab.id}`} aria-selected={page === tab.id}
            tabIndex={page === tab.id ? 0 : -1} onClick={() => setPage(tab.id)}>{tab.label}</button>
        ))}
      </div>

      <div ref={page === 'main' ? bodyRef : undefined} className="menu-scroll-body" role="tabpanel"
        id={`${titleId}-panel-main`} aria-labelledby={`${titleId}-tab-main`} hidden={page !== 'main'}>
        <div className="menu-btn-grid" role="group" aria-label="Действия с Wisp">
          {createInteractionMenuActions({ onPet, onPlay, onFeed, onThink }).map(action =>
            <button key={action.id} type="button" className="menu-action-btn" onClick={action.onSelect}>{action.label}</button>
          )}
          <MenuToggle label="Тихий режим" enabled={quietMode} onToggle={onToggleQuietMode} />
          <button type="button" className="menu-action-btn" onClick={onToggleSleep}>
            {isSleeping ? 'Разбудить' : 'Усыпить'}
          </button>
        </div>
        <div className="menu-status" role="status">
          <p>Автономность на паузе. После закрытия {autoWanderEnabled ? 'возобновится' : 'останется выключенной'}.</p>
          <p>{externalWindowSupport ? SUPPORT_LABELS[externalWindowSupport] : 'Доступность окон пока неизвестна'}</p>
        </div>
        <button type="button" className="menu-quit-btn" onClick={onQuit}>Выйти из приложения</button>
      </div>

      <div ref={page === 'settings' ? bodyRef : undefined} className="menu-scroll-body" role="tabpanel"
        id={`${titleId}-panel-settings`} aria-labelledby={`${titleId}-tab-settings`} hidden={page !== 'settings'}>
        {page === 'settings' && <div className="menu-settings">
          {aiConnectionContent}
          {observationContent}
          {voiceContent}
          <section className="menu-section" aria-label="Поведение и окно">
            <h3 className="menu-settings-heading">Поведение и окно</h3>
            <div className="menu-window-controls">
              <MenuToggle label="Автономность после закрытия" enabled={autoWanderEnabled} onToggle={onToggleWander} />
              {onToggleAlwaysOnTop && <MenuToggle label="Поверх окон" enabled={isAlwaysOnTop} onToggle={onToggleAlwaysOnTop} />}
              {onResetPosition && <button type="button" className="menu-action-btn" onClick={onResetPosition}>Сбросить позицию</button>}
            </div>
          </section>
          {(previewContent || debugHudEnabled) && <section className="menu-section" aria-label="Инструменты">
            <h3 className="menu-settings-heading">Инструменты</h3>
            {previewContent}
            {debugHudEnabled && <section className="menu-debug-controls" aria-label="Отладка">
              <h4 className="menu-section-title">Отладка</h4>
              {onToggleDebugHud && <MenuToggle label="Показывать панель отладки" enabled={debugHudVisible} onToggle={onToggleDebugHud} />}
              {debugContent ?? <div className="debug-log-empty">Нет данных отладки</div>}
            </section>}
          </section>}
        </div>}
      </div>
    </div>
  );
}
