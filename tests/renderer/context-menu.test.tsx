import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu } from '../../src/renderer/components/Interaction/ContextMenu';
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

  it('renders actions, themes, and scales when opened in main tab', () => {
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
        onClose={vi.fn()}
        onPet={vi.fn()}
        onThink={vi.fn()}
        onToggleSleep={vi.fn()}
        onToggleWander={vi.fn()}
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
    expect(markup).toContain('Подумать');
    expect(markup).toContain('Усыпить');
    expect(markup).toContain('Прогулка: ВКЛ');
    expect(markup).toContain('🎬 Анимации тела');
    expect(markup).toContain('🎭 Выражения лица');
    expect(markup).toContain('😊 Радость');
    expect(markup).toContain('😢 Грусть');
    expect(markup).toContain('😠 Злость');
    expect(markup).toContain('🌿 Дыхание');
    expect(markup).toContain('🐾 Ходьба');
    expect(markup).toContain('💖 Радость');
    expect(markup).toContain('💡 Мысли');
    expect(markup).toContain('Космический');
    expect(markup).toContain('100%');
    expect(markup).toContain('Выйти из приложения');
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

  it('renders debug content when activeTab is debug', () => {
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
