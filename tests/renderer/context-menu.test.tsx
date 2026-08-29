import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  calculateContextMenuPosition,
  ContextMenu,
  createInteractionMenuActions,
  createPoseMenuActions,
  subscribeToOutsideMouseDown,
} from '../../src/renderer/components/Interaction/ContextMenu';
import { DEFAULT_THEMES } from '../../src/domain/models/character-visuals';

describe('Renderer: ContextMenu', () => {
  it('returns null when isOpen is false', () => {
    const markup = renderToStaticMarkup(
      <ContextMenu
        isOpen={false}
        currentTheme={DEFAULT_THEMES.cosmic!}
        scale={1.0}
        autoWanderEnabled
        isSleeping={false}
        debugHudEnabled={false}
        onClose={vi.fn()}
        onPet={vi.fn()}
        onPlay={vi.fn()}
        onFeed={vi.fn()}
        onThink={vi.fn()}
        onToggleSleep={vi.fn()}
        onToggleWander={vi.fn()}
        onSelectTheme={vi.fn()}
        onSelectScale={vi.fn()}
        onQuit={vi.fn()}
      />
    );

    expect(markup).toBe('');
  });

  it('renders actions, themes, and scales in unified layout without position override', () => {
    const markup = renderToStaticMarkup(
      <ContextMenu
        isOpen
        activeTab="main"
        tone="affectionate"
        currentTheme={DEFAULT_THEMES.cosmic!}
        scale={1.0}
        autoWanderEnabled
        isSleeping={false}
        debugHudEnabled
        debugContent={<div>Debug Telemetry</div>}
        isAlwaysOnTop={true}
        onClose={vi.fn()}
        onPet={vi.fn()}
        onPlay={vi.fn()}
        onFeed={vi.fn()}
        onThink={vi.fn()}
        onToggleSleep={vi.fn()}
        onToggleWander={vi.fn()}
        onToggleDebugHud={vi.fn()}
        onToggleAlwaysOnTop={vi.fn()}
        onResetPosition={vi.fn()}
        onPlayAnimation={vi.fn()}
        onSelectFace={vi.fn()}
        onSelectTheme={vi.fn()}
        onSelectScale={vi.fn()}
        onQuit={vi.fn()}
      />
    );

    expect(markup).toContain('Wisp Companion');
    expect(markup).toContain('Нежное');
    expect(markup).toContain('Погладить');
    expect(markup).toContain('Поиграть');
    expect(markup).toContain('Покормить');
    expect(markup).toContain('Подумать');
    expect(markup).toContain('Усыпить');
    expect(markup).toContain('Прогулка: ВКЛ');
    expect(markup).toContain('🎬 Анимации и позы');
    expect(markup).toContain('🎭 Выражения лица');
    expect(markup).toContain('😊 Радость');
    expect(markup).toContain('😢 Грусть');
    expect(markup).toContain('😠 Злость');
    expect(markup).toContain('🌿 Дыхание');
    expect(markup).toContain('🐾 Ходьба');
    expect(markup).toContain('💖 Радость');
    expect(markup).toContain('💡 Мысли');
    expect(markup).toContain('Сесть');
    expect(markup).toContain('Лечь');
    expect(markup).toContain('Встать');
    expect(markup).toContain('Бегать');
    expect(markup).toContain('Сбросить позицию');
    expect(markup).toContain('Поверх окон: ВКЛ');
    expect(markup).toContain('Debug HUD: ВЫКЛ');
    expect(markup).toContain('Космический');
    expect(markup).toContain('100%');
    expect(markup).toContain('Выйти из приложения');
    // Verify it doesn't force inline position style so side-by-side CSS layout applies
    expect(markup).not.toContain('style="left:');
  });

  it('applies positioned style when explicit position anchor is provided', () => {
    const markup = renderToStaticMarkup(
      <ContextMenu
        isOpen
        position={{ x: 100, y: 120 }}
        currentTheme={DEFAULT_THEMES.cosmic!}
        scale={1.0}
        autoWanderEnabled
        isSleeping={false}
        debugHudEnabled={false}
        onClose={vi.fn()}
        onPet={vi.fn()}
        onThink={vi.fn()}
        onToggleSleep={vi.fn()}
        onToggleWander={vi.fn()}
        onSelectTheme={vi.fn()}
        onSelectScale={vi.fn()}
        onQuit={vi.fn()}
      />
    );

    expect(markup).toContain('style="left:100px;top:12px;right:auto;bottom:auto;width:580px"');
  });

  it('clamps cursor-based position inside every viewport edge', () => {
    expect(calculateContextMenuPosition({ x: -100, y: -50 }, { width: 880, height: 580 }))
      .toEqual({ x: 12, y: 12 });
    expect(calculateContextMenuPosition({ x: 999, y: 999 }, { width: 880, height: 580 }))
      .toEqual({ x: 288, y: 12 });
    expect(calculateContextMenuPosition({ x: 100, y: 100 }, { width: 200, height: 180 }))
      .toEqual({ x: 12, y: 12 });
  });

  it('binds interaction and pose callbacks to the expected menu actions', () => {
    const callbacks = {
      onPet: vi.fn(),
      onPlay: vi.fn(),
      onFeed: vi.fn(),
      onThink: vi.fn(),
    };
    const interactionActions = createInteractionMenuActions(callbacks);

    for (const action of interactionActions) action.onSelect();

    expect(callbacks.onPet).toHaveBeenCalledOnce();
    expect(callbacks.onPlay).toHaveBeenCalledOnce();
    expect(callbacks.onFeed).toHaveBeenCalledOnce();
    expect(callbacks.onThink).toHaveBeenCalledOnce();

    const onPlayAnimation = vi.fn();
    const poseActions = createPoseMenuActions(onPlayAnimation);
    for (const action of poseActions) action.onSelect();

    expect(onPlayAnimation.mock.calls.map(([event]) => event)).toEqual([
      'SIT',
      'LIE_DOWN',
      'STAND_UP',
      'RUN',
    ]);
  });

  it('closes only for outside mousedown and removes the same listener on cleanup', () => {
    const insideTarget = {} as Node;
    const outsideTarget = {} as Node;
    const onClose = vi.fn();
    let listener: ((event: MouseEvent) => void) | undefined;
    const ownerDocument = {
      addEventListener: vi.fn((_type: string, nextListener: (event: MouseEvent) => void) => {
        listener = nextListener;
      }),
      removeEventListener: vi.fn(),
    } as unknown as Document;
    const menuElement = {
      contains: (target: Node | null) => target === insideTarget,
    } as Pick<HTMLDivElement, 'contains'>;

    const cleanup = subscribeToOutsideMouseDown(ownerDocument, menuElement, onClose);
    const handleMouseDown = listener;
    if (handleMouseDown === undefined) throw new Error('Outside-click listener was not registered.');
    handleMouseDown({ target: insideTarget } as unknown as MouseEvent);
    handleMouseDown({ target: outsideTarget } as unknown as MouseEvent);

    expect(onClose).toHaveBeenCalledOnce();
    cleanup();
    expect(ownerDocument.removeEventListener).toHaveBeenCalledWith('mousedown', handleMouseDown);
  });

  it('renders wake-up button when pet is sleeping', () => {
    const markup = renderToStaticMarkup(
      <ContextMenu
        isOpen
        activeTab="main"
        currentTheme={DEFAULT_THEMES.cosmic!}
        scale={1.0}
        autoWanderEnabled={false}
        isSleeping
        debugHudEnabled={false}
        onClose={vi.fn()}
        onPet={vi.fn()}
        onThink={vi.fn()}
        onToggleSleep={vi.fn()}
        onToggleWander={vi.fn()}
        onSelectTheme={vi.fn()}
        onSelectScale={vi.fn()}
        onQuit={vi.fn()}
      />
    );

    expect(markup).toContain('☀️ Разбудить');
  });

  it('renders debug content directly in the unified panel when debugContent is provided', () => {
    const markup = renderToStaticMarkup(
      <ContextMenu
        isOpen
        activeTab="debug"
        currentTheme={DEFAULT_THEMES.cosmic!}
        scale={1.0}
        autoWanderEnabled
        isSleeping={false}
        debugHudEnabled
        debugContent={<div data-testid="telemetry-panel">Active Telemetry Panel</div>}
        onClose={vi.fn()}
        onPet={vi.fn()}
        onThink={vi.fn()}
        onToggleSleep={vi.fn()}
        onToggleWander={vi.fn()}
        onSelectTheme={vi.fn()}
        onSelectScale={vi.fn()}
        onQuit={vi.fn()}
      />
    );

    expect(markup).toContain('Active Telemetry Panel');
  });
});
