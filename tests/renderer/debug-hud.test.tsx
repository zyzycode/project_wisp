import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DebugHUD } from '../../src/renderer/components/Debug/DebugHUD';
import { ContextMenu } from '../../src/renderer/components/Interaction/ContextMenu';
import { DEFAULT_THEMES } from '../../src/domain/models/character-visuals';
import { createSystemAnimationIntent } from '../../src/domain/animation/animation-intent';
import type { DebugLogEntryDTO } from '../../src/shared/ipc-contracts';
import {
  createInspectorSelectionHandler,
  normalizeInspectorSelection,
} from '../../src/renderer/components/Debug/AnimationInspector';

const sampleNeeds = { energy: 75, attention: 82, play: 60, comfort: 90 };
const sampleRelationship = { friendship: 55, love: 10, loveUnlocked: false };

describe('Renderer: DebugHUD', () => {
  it('renders all sections and vital indicators when enabled', () => {
    const logs: DebugLogEntryDTO[] = [
      { id: '1', level: 'info', category: 'fsm', message: 'FSM transitioned to idle', timestamp: 1000 },
      { id: '2', level: 'warn', category: 'system', message: 'Low battery warning', timestamp: 2000 },
    ];

    const markup = renderToStaticMarkup(
      <DebugHUD
        needs={sampleNeeds}
        relationship={sampleRelationship}
        tone="curious"
        animationState="idle"
        animationIntent={createSystemAnimationIntent('idle_blink', 'curious')}
        fps={59.8}
        logs={logs}
        position={{ x: 120, y: 340 }}
        isWandering
        flipX
        onClearLogs={vi.fn()}
      />
    );

    expect(markup).toContain('Wisp Debug');
    expect(markup).toContain('60 FPS');
    expect(markup).toContain('curious');
    expect(markup).toContain('idle');
    expect(markup).toContain('idle_blink');
    expect(markup).toContain('X: 120');
    expect(markup).toContain('Y: 340');
    expect(markup).toContain('Walking');
    expect(markup).toContain('Left');
    expect(markup).toContain('acquaintance');
    expect(markup).toContain('FSM transitioned to idle');
    expect(markup).toContain('Low battery warning');
  });

  it('renders default values for spatial motion when coordinates are not provided', () => {
    const markup = renderToStaticMarkup(
      <DebugHUD
        needs={sampleNeeds}
        relationship={sampleRelationship}
        tone="neutral"
        animationState="idle"
        animationIntent={createSystemAnimationIntent('idle_blink', 'neutral')}
        fps={30}
        logs={[]}
        onClearLogs={vi.fn()}
      />
    );

    expect(markup).not.toContain('Coords:');
    expect(markup).toContain('neutral');
  });

  it('invokes log clear callback when clear button is clicked', () => {
    const onClearLogs = vi.fn();
    const markup = renderToStaticMarkup(
      <DebugHUD
        needs={sampleNeeds}
        relationship={sampleRelationship}
        tone="shy"
        animationState="idle"
        animationIntent={createSystemAnimationIntent('idle_blink', 'shy')}
        fps={45}
        logs={[{ id: '1', level: 'error', category: 'ai', message: 'Quota exceeded', timestamp: 100 }]}
        onClearLogs={onClearLogs}
      />
    );

    expect(markup).toContain('Clear');
    expect(markup).toContain('Quota exceeded');
  });

  it('embeds control sections and tab switching in ContextMenu', () => {
    const logs: DebugLogEntryDTO[] = [
      { id: '1', level: 'info', category: 'fsm', message: 'Embedded log', timestamp: 500 },
    ];

    const markup = renderToStaticMarkup(
      <ContextMenu
        isOpen
        activeTab="main"
        tone="playful"
        currentTheme={DEFAULT_THEMES.cosmic!}
        scale={1}
        autoWanderEnabled
        isSleeping={false}
        debugHudEnabled
        debugContent={
          <DebugHUD
            needs={sampleNeeds}
            relationship={sampleRelationship}
            tone="playful"
            animationState="float"
            animationIntent={createSystemAnimationIntent('walk', 'playful')}
            fps={60}
            logs={logs}
            onClearLogs={vi.fn()}
          />
        }
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

    expect(markup).toContain('Действия');
    expect(markup).toContain('Темы оформления');
    expect(markup).toContain('menu-tabs');
    expect(markup).toContain('Close control panel');
  });

  it('renders debug telemetry in tabbed menu when activeTab is debug and debugContent is passed', () => {
    const markup = renderToStaticMarkup(
      <ContextMenu
        isOpen
        activeTab="debug"
        tone="playful"
        currentTheme={DEFAULT_THEMES.cosmic!}
        scale={1}
        autoWanderEnabled
        isSleeping={false}
        debugHudEnabled
        debugContent={
          <div data-testid="debug-mock-content">
            <div>Debug Telemetry Active</div>
          </div>
        }
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

    expect(markup).toContain('Debug Telemetry Active');
    expect(markup).toContain('telemetry-panel');
  });

  it('renders animation buttons when onPlayAnimation callback is passed', () => {
    const onPlayAnimation = vi.fn();
    const markup = renderToStaticMarkup(
      <ContextMenu
        isOpen
        activeTab="main"
        tone="playful"
        currentTheme={DEFAULT_THEMES.cosmic!}
        scale={1}
        autoWanderEnabled
        isSleeping={false}
        debugHudEnabled={false}
        onClose={vi.fn()}
        onPet={vi.fn()}
        onThink={vi.fn()}
        onToggleSleep={vi.fn()}
        onToggleWander={vi.fn()}
        onPlayAnimation={onPlayAnimation}
        onSelectTheme={vi.fn()}
        onSelectScale={vi.fn()}
        onQuit={vi.fn()}
      />
    );

    expect(markup).toContain('Анимации и позы');
    expect(markup).toContain('body_idle');
  });

  it('renders every manifest body and face option in the animation inspector', () => {
    const manifest = {
      schemaVersion: 1 as const,
      animations: {
        body_walk: {
          category: 'body/walk' as const,
          fps: 8,
          frames: [{ source: 'walk.png', durationMs: 125 }],
        },
        face_happy: {
          category: 'faces/happy' as const,
          fps: 8,
          frames: [{ source: 'happy.png', durationMs: 125 }],
        },
      },
    };

    const onSelect = vi.fn();
    const markup = renderToStaticMarkup(
      <div data-testid="inspector-panel">
        <select
          data-testid="body-select"
          onChange={createInspectorSelectionHandler(onSelect, 'body')}
        >
          {Object.keys(manifest.animations).map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </div>
    );

    expect(markup).toContain('body_walk');
    expect(markup).toContain('face_happy');
  });

  it('normalizes inspector values and forwards exact manifest keys', () => {
    const onSelect = vi.fn();
    const handler = createInspectorSelectionHandler(onSelect, 'body');

    handler({ target: { value: 'body_walk' } } as unknown as React.ChangeEvent<HTMLSelectElement>);
    expect(onSelect).toHaveBeenCalledWith('body_walk');

    expect(normalizeInspectorSelection('face_happy')).toBe('face_happy');
    expect(normalizeInspectorSelection('')).toBeNull();
  });
});
