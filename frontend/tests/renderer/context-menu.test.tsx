import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  calculateContextMenuPosition,
  ContextMenu,
  createInteractionMenuActions,
  subscribeToOutsideMouseDown,
} from '../../src/renderer/components/Interaction/ContextMenu';
import { AnimationPreviewControls } from '../../src/renderer/components/Interaction/AnimationPreviewControls';
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

  it('renders actions, themes, and scales in compact layout without position override', () => {
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
        previewContent={<AnimationPreviewControls
          bodyKeys={['body_idle', 'body_walk', 'body_petting', 'body_thinking', 'body_sit', 'body_lie', 'body_stand_up', 'body_run', 'body_surface_touch']}
          faceKeys={['face_happy', 'face_sad', 'face_angry']}
          bodyKey="body_sit" faceKey={null} loop
          onSelectBody={vi.fn()} onSelectFace={vi.fn()} onToggleLoop={vi.fn()} onReplay={vi.fn()}
        />}
        onSelectTheme={vi.fn()}
        onSelectScale={vi.fn()}
        onQuit={vi.fn()}
      />
    );

    expect(markup).toContain('Wisp Companion');
    expect(markup).toContain('Автономность приостановлена');
    expect(markup).toContain('Нежное');
    expect(markup).toContain('Погладить');
    expect(markup).toContain('Поиграть');
    expect(markup).toContain('Покормить');
    expect(markup).toContain('Подумать');
    expect(markup).toContain('Усыпить');
    expect(markup).toContain('После закрытия: автономность ВКЛ');
    expect(markup).toContain('Анимации и позы');
    expect(markup).toContain('body_surface_touch');
    expect(markup).toContain('С начала');
    expect(markup).toContain('Сбросить просмотр');
    expect(markup).toContain('Повтор: ВКЛ');
    expect(markup).toContain('Выражения лица');
    expect(markup).toContain('face_happy');
    expect(markup).toContain('face_sad');
    expect(markup).toContain('face_angry');
    expect(markup).toContain('body_idle');
    expect(markup).toContain('body_walk');
    expect(markup).toContain('body_petting');
    expect(markup).toContain('body_thinking');
    expect(markup).toContain('body_sit');
    expect(markup).toContain('body_lie');
    expect(markup).toContain('body_stand_up');
    expect(markup).toContain('body_run');
    expect(markup).toContain('Сбросить позицию');
    expect(markup).toContain('Поверх окон: ВКЛ');
    expect(markup).toContain('Debug HUD: ВЫКЛ');
    expect(markup).toContain('Космический');
    expect(markup).toContain('100%');
    expect(markup).toContain('Выйти из приложения');
    expect(markup).toContain('Главное');
    expect(markup).toContain('Debug');
    // Verify it doesn't force inline position style so docked CSS layout applies
    expect(markup).not.toContain('style="left:');
  });

  it('renders debug panel when activeTab is debug and debugHudEnabled is true', () => {
    const markup = renderToStaticMarkup(
      <ContextMenu
        isOpen
        activeTab="debug"
        currentTheme={DEFAULT_THEMES.cosmic!}
        scale={1.0}
        autoWanderEnabled
        isSleeping={false}
        debugHudEnabled
        debugContent={<div data-testid="debug-view">Telemetry Active</div>}
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

    expect(markup).toContain('Telemetry Active');
    expect(markup).toContain('telemetry-panel');
    expect(markup).not.toContain('menu-scroll-body');
  });

  it('applies positioned style when explicit position anchor is provided', () => {
    const markup = renderToStaticMarkup(
      <ContextMenu
        isOpen
        position={{ x: 100, y: 50 }}
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

    expect(markup).toContain('style="left:100px;top:50px;right:auto;bottom:auto;width:340px"');
  });

  it('clamps cursor-based position inside every viewport edge', () => {
    expect(calculateContextMenuPosition({ x: -100, y: -50 }, { width: 880, height: 580 }))
      .toEqual({ x: 12, y: 12 });
    expect(calculateContextMenuPosition({ x: 999, y: 999 }, { width: 880, height: 580 }))
      .toEqual({ x: 528, y: 68 });
    expect(calculateContextMenuPosition({ x: 100, y: 100 }, { width: 200, height: 180 }))
      .toEqual({ x: 12, y: 12 });
  });

  it('binds interaction callbacks to the expected menu actions', () => {
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


  });

  it('unsubscribes mouse event listener correctly on outside clicks', () => {
    const removeEventListenerMock = vi.fn();
    const addEventListenerMock = vi.fn();
    const fakeDocument = {
      addEventListener: addEventListenerMock,
      removeEventListener: removeEventListenerMock,
    } as unknown as Document;

    const fakeMenuElement = {
      contains: vi.fn().mockReturnValue(false),
    };

    const onCloseMock = vi.fn();
    const unsubscribe = subscribeToOutsideMouseDown(fakeDocument, fakeMenuElement, onCloseMock);

    expect(addEventListenerMock).toHaveBeenCalledWith('mousedown', expect.any(Function));

    const handler = addEventListenerMock.mock.calls[0]?.[1] as (event: MouseEvent) => void;
    handler({ target: {} } as unknown as MouseEvent);
    expect(onCloseMock).toHaveBeenCalledOnce();

    unsubscribe();
    expect(removeEventListenerMock).toHaveBeenCalledWith('mousedown', handler);
  });
});
