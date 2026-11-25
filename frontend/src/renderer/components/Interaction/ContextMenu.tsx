import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { SynthesizedEmotionalTone } from '../../../domain/character/types';
import type { BrainStateDTO } from '../../../shared/ipc-contracts';

type ContextMenuPage = 'main' | 'settings' | 'voice' | 'window' | 'tools' | 'animations' | 'debug';

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

const PAGE_TITLES: Record<ContextMenuPage, string> = {
  main: 'Wisp',
  settings: 'Настройки',
  voice: 'Голос и звук',
  window: 'Поведение и окно',
  tools: 'Инструменты',
  animations: 'Анимации и позы',
  debug: 'Отладка',
};

const PARENT_PAGE: Record<Exclude<ContextMenuPage, 'main'>, ContextMenuPage> = {
  settings: 'main',
  voice: 'settings',
  window: 'settings',
  tools: 'main',
  animations: 'tools',
  debug: 'tools',
};

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
    'button:enabled, input:enabled, select:enabled, textarea:enabled, summary, a[href], [tabindex="0"]',
  )).filter(control => control.getClientRects().length > 0);
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
  const [requestedPage, setPage] = useState<ContextMenuPage>('main');
  const toolsAvailable = Boolean(previewContent) || debugHudEnabled;
  const availability: Partial<Record<ContextMenuPage, boolean>> = {
    voice: Boolean(voiceContent), tools: toolsAvailable, animations: Boolean(previewContent), debug: debugHudEnabled,
  };
  const page = availability[requestedPage] === false ? 'main' : requestedPage;
  const titleId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const previous = menuRef.current?.ownerDocument.activeElement;
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
    titleRef.current?.focus({ preventScroll: true });
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

  const pageButton = (destination: ContextMenuPage) => (
    <button type="button" className="menu-page-btn" data-menu-link={destination} onClick={() => setPage(destination)}>
      {PAGE_TITLES[destination]}<span aria-hidden="true">›</span>
    </button>
  );

  return (
    <div ref={menuRef} className="wisp-context-menu" data-wisp-interactive="true" data-menu-page={page}
      onClick={event => event.stopPropagation()} onKeyDown={keepTabFocus}
      onContextMenu={event => event.preventDefault()} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="menu-header">
        {page !== 'main' && <button type="button" className="menu-back-btn" aria-label="Назад"
          onClick={() => setPage(PARENT_PAGE[page])}>‹</button>}
        <h2 ref={titleRef} id={titleId} className="menu-title" tabIndex={-1}>{PAGE_TITLES[page]}</h2>
        {page === 'main' && <span className="menu-status-pill">{TONE_LABELS_RU[tone] ?? tone}</span>}
        <button type="button" className="menu-close-btn" aria-label="Закрыть меню" onClick={onClose}>✕</button>
      </header>

      <div ref={bodyRef} className="menu-scroll-body">
        {page === 'main' && <>
          <div className="menu-btn-grid" role="group" aria-label="Действия с Wisp">
            {createInteractionMenuActions({ onPet, onPlay, onFeed, onThink }).map(action =>
              <button key={action.id} type="button" className="menu-action-btn" onClick={action.onSelect}>{action.label}</button>
            )}
            <MenuToggle label="Тихий режим" enabled={quietMode} onToggle={onToggleQuietMode} />
            <button type="button" className="menu-action-btn" onClick={onToggleSleep}>
              {isSleeping ? 'Разбудить' : 'Усыпить'}
            </button>
          </div>
          <nav className="menu-navigation" aria-label="Разделы меню">
            {pageButton('settings')}
            {toolsAvailable && pageButton('tools')}
          </nav>
          <div className="menu-status" role="status">
            <p>Автономность на паузе. После закрытия {autoWanderEnabled ? 'возобновится' : 'останется выключенной'}.</p>
            <p>{externalWindowSupport ? SUPPORT_LABELS[externalWindowSupport] : 'Доступность окон пока неизвестна'}</p>
          </div>
          <button type="button" className="menu-quit-btn" onClick={onQuit}>Выйти из приложения</button>
        </>}

        {page === 'settings' && <div className="menu-settings">
          {aiConnectionContent}
          {observationContent}
          {voiceContent && pageButton('voice')}
          {pageButton('window')}
        </div>}

        {page === 'window' && <div className="menu-navigation">
          <MenuToggle label="Автономность после закрытия" enabled={autoWanderEnabled} onToggle={onToggleWander} />
          {onToggleAlwaysOnTop && <MenuToggle label="Поверх окон" enabled={isAlwaysOnTop} onToggle={onToggleAlwaysOnTop} />}
          {onResetPosition && <button type="button" className="menu-action-btn" onClick={onResetPosition}>Сбросить позицию</button>}
        </div>}

        {page === 'tools' && <div className="menu-navigation">
          {previewContent && pageButton('animations')}
          {debugHudEnabled && pageButton('debug')}
        </div>}
        {page === 'voice' && voiceContent}
        {page === 'animations' && previewContent}
        {page === 'debug' && <>
          {onToggleDebugHud && <MenuToggle label="Показывать панель отладки" enabled={debugHudVisible} onToggle={onToggleDebugHud} />}
          {debugContent ?? <div className="debug-log-empty">Нет данных отладки</div>}
        </>}
      </div>
    </div>
  );
}
