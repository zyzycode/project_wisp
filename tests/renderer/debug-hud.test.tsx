import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DebugLogEntryDTO } from '../../src/shared/ipc-contracts';
import { createSystemAnimationIntent } from '../../src/domain/animation/animation-intent';
import { DebugHUD, getVisibleLogs, LogViewer } from '../../src/renderer/components/Debug';
import { ContextMenu } from '../../src/renderer/components/Interaction/ContextMenu';
import { DEFAULT_THEMES } from '../../src/domain/models/character-visuals';

const logs: DebugLogEntryDTO[] = [
  { id: 'debug', level: 'debug', context: 'FSM', message: 'idle entered', createdAt: '2026-08-28T00:00:00.000Z' },
  { id: 'info', level: 'info', context: 'RenderEngine', message: 'frame updated', createdAt: '2026-08-28T00:00:01.000Z' },
  { id: 'warn', level: 'warn', context: 'Needs', message: 'attention high', createdAt: '2026-08-28T00:00:02.000Z' },
  { id: 'error', level: 'error', context: 'IPC', message: 'bridge unavailable', createdAt: '2026-08-28T00:00:03.000Z' },
];

describe('Renderer: DebugHUD', () => {
  it('renders live needs, relationship, emotion, FSM, intent, FPS, and log telemetry', () => {
    const markup = renderToStaticMarkup(
      <DebugHUD
        needs={{ energy: 81, attention: 42, play: 60, comfort: 18 }}
        relationship={{ friendship: 420, love: 35, loveUnlocked: false }}
        tone="playful"
        animationState="float"
        animationIntent={createSystemAnimationIntent('walk', 'playful')}
        fps={58.7}
        logs={logs}
        onClearLogs={vi.fn()}
      />
    );

    expect(markup).toContain('Wisp Debug');
    expect(markup).toContain('59 FPS');
    expect(markup).toContain('Energy');
    expect(markup).toContain('aria-valuenow="81"');
    expect(markup).toContain('Friendship: 420');
    expect(markup).toContain('Love: locked (35)');
    expect(markup).toContain('Tone:');
    expect(markup).toContain('playful');
    expect(markup).toContain('FSM:');
    expect(markup).toContain('float');
    expect(markup).toContain('Intent:');
    expect(markup).toContain('walk');
    expect(markup).toContain('debug-log-error');
  });

  it('shows the latest twenty logs with level-specific styling and controls', () => {
    const manyLogs = Array.from({ length: 24 }, (_, index): DebugLogEntryDTO => ({
      id: `log-${index}`,
      level: index === 23 ? 'error' : 'info',
      context: 'Autonomy',
      message: `log ${index}`,
      createdAt: '2026-08-28T00:00:00.000Z',
    }));
    const markup = renderToStaticMarkup(<LogViewer logs={manyLogs} onClear={vi.fn()} />);

    expect(markup).not.toContain('log 0');
    expect(markup).toContain('log 23');
    expect(markup).toContain('debug-log-error');
    expect(markup).toContain('Pause');
    expect(markup).toContain('Clear');
  });

  it('keeps a frozen log snapshot while paused and refreshes on resume', () => {
    const frozen = logs.slice(0, 2);
    const incoming = [...frozen, { id: 'later', level: 'info' as const, context: 'IPC' as const, message: 'later entry', createdAt: '2026-08-28T00:01:00.000Z' }];

    expect(getVisibleLogs(incoming, true, frozen).map((entry) => entry.id)).toEqual(['debug', 'info']);
    expect(getVisibleLogs(incoming, false, null).map((entry) => entry.id)).toEqual(['debug', 'info', 'later']);
  });

  it('embeds every control section and debug telemetry in one canvas', () => {
    const markup = renderToStaticMarkup(
      <ContextMenu
        isOpen
        affection={{ mood: 'content', affectionScore: 70, lastInteractionAt: 0 }}
        currentTheme={DEFAULT_THEMES.cosmic!}
        scale={1}
        autoWanderEnabled
        isSleeping={false}
        debugHudEnabled
        debugContent={
          <DebugHUD
            needs={{ energy: 80, attention: 50, play: 40, comfort: 30 }}
            relationship={{ friendship: 420, love: 35, loveUnlocked: false }}
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
        onSpook={vi.fn()}
        onToggleSleep={vi.fn()}
        onToggleWander={vi.fn()}
        onSelectTheme={vi.fn()}
        onSelectScale={vi.fn()}
        onQuit={vi.fn()}
      />
    );

    expect(markup).toContain('🎮 Действия');
    expect(markup).toContain('🎨 Внешний вид');
    expect(markup).toContain('🛠️ Debug');
    expect(markup).toContain('menu-canvas');
    expect(markup).toContain('Close control panel');
    expect(markup).toContain('data-testid="debug-hud"');
    expect(markup).not.toContain('menu-tabs');
  });
});
