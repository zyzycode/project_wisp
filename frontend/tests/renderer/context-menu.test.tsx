import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  ContextMenu,
  createInteractionMenuActions,
  subscribeToOutsideMouseDown,
} from '../../src/renderer/components/Interaction/ContextMenu';
import { AnimationPreviewControls } from '../../src/renderer/components/Interaction/AnimationPreviewControls';

describe('Renderer: ContextMenu', () => {
  it('returns null when isOpen is false', () => {
    const markup = renderToStaticMarkup(
      <ContextMenu
        isOpen={false}
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
        onQuit={vi.fn()}
      />
    );

    expect(markup).toBe('');
  });

  it('puts frequent actions and section entry points on the main page', () => {
    const menu = (
      <ContextMenu
        isOpen
        tone="affectionate"
        autoWanderEnabled
        quietMode
        onToggleQuietMode={vi.fn()}
        isSleeping={false}
        debugHudEnabled
        debugContent={<div>Debug Telemetry</div>}
        isAlwaysOnTop={true}
        voiceContent={<div>Audio device selector</div>}
        aiConnectionContent={<div>Подключение AI</div>}
        observationContent={<div>Наблюдение</div>}
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
        previewContent={<div>Animation preview</div>}
        onQuit={vi.fn()}
      />
    );

    const markup = renderToStaticMarkup(menu);
    expect(markup).not.toContain('Animation preview');
    expect(markup).not.toContain('Audio device selector');
    expect(markup).not.toContain('Подключение AI');
    expect(markup).not.toContain('Наблюдение');
    expect(markup).not.toContain('Сбросить позицию');
    expect(markup).not.toContain('Отладка');
    expect(markup).not.toContain('Debug Telemetry');
    expect(markup.match(/<button\b/g)).toHaveLength(10);

    expect(markup).toContain('>Wisp</h2>');
    expect(markup).toContain('Автономность на паузе. После закрытия возобновится.');
    expect(markup).toContain('Нежное');
    expect(markup).toContain('Погладить');
    expect(markup).toContain('Поиграть');
    expect(markup).toContain('Покормить');
    expect(markup).toContain('Подумать');
    expect(markup).toContain('Усыпить');
    expect(markup).toContain('Тихий режим');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup.match(/role="tab"/g)).toHaveLength(2);
    expect(markup).toContain('data-menu-tab="main"');
    expect(markup).toContain('data-menu-tab="settings"');
    expect(markup).not.toContain('<details');
    expect(markup).not.toContain('Темы оформления');
    expect(markup).not.toContain('menu-theme');
    expect(markup).not.toContain('Космический');
    expect(markup).not.toContain('Изумрудный');
    expect(markup).not.toContain('Янтарный');
    expect(markup).not.toContain('Размер:');
    expect(markup).not.toContain('Уменьшить');
    expect(markup).not.toContain('Увеличить');
    expect(markup).not.toContain('100%');
    expect(markup).toContain('Выйти из приложения');
  });

  it('keeps the animation preview commands and named face and body poses', () => {
    const bodyKeys = [
      'body_idle', 'body_walk', 'body_petting', 'body_thinking', 'body_sit',
      'body_lie', 'body_stand_up', 'body_run', 'body_surface_touch',
    ];
    const faceKeys = ['face_happy', 'face_sad', 'face_angry'];
    const markup = renderToStaticMarkup(<AnimationPreviewControls
      bodyKeys={bodyKeys}
      faceKeys={faceKeys}
      bodyKey="body_sit"
      faceKey={null}
      loop
      onSelectBody={vi.fn()}
      onSelectFace={vi.fn()}
      onToggleLoop={vi.fn()}
      onReplay={vi.fn()}
    />);

    for (const label of [...bodyKeys, ...faceKeys, 'С начала', 'Сбросить просмотр', 'Повтор: ВКЛ', 'Выражения лица']) {
      expect(markup).toContain(label);
    }
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

describe('external window status in ordinary menu', () => {
  it.each([
    ['available', 'Опоры на окнах доступны'], ['initializing', 'Проверяем доступность окон'],
    ['unsupported', 'Опоры на окнах не поддерживаются'], ['unavailable', 'Окна недоступны'],
    [undefined, 'Доступность окон пока неизвестна'],
  ] as const)('shows %s without enabling debug', (externalWindowSupport, label) => {
    const markup = renderToStaticMarkup(<ContextMenu isOpen externalWindowSupport={externalWindowSupport}
      autoWanderEnabled isSleeping={false} debugHudEnabled={false}
      onClose={vi.fn()} onPet={vi.fn()} onThink={vi.fn()} onToggleSleep={vi.fn()} onToggleWander={vi.fn()}
      onQuit={vi.fn()} />);
    expect(markup).toContain(label);
  });
});
