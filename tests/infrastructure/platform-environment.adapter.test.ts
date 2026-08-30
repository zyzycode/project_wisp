import { describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  on: vi.fn(),
  removeListener: vi.fn(),
  getPrimaryDisplay: vi.fn(() => ({
    workArea: { x: -50, y: 30, width: 1600, height: 900 },
  })),
}));

vi.mock('electron', () => ({
  screen: electronMock,
}));

import { PlatformEnvironmentAdapter } from '../../src/infrastructure/platform/platform-environment.adapter';

describe('PlatformEnvironmentAdapter', () => {
  it('maps the primary display work area to a screen-floor environment snapshot', () => {
    const snapshot = new PlatformEnvironmentAdapter().getSnapshot();

    expect(snapshot.capturedAtMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.screenBounds).toEqual({
      id: 'primary_screen', x: -50, y: 30, width: 1600, height: 900,
    });
    expect(snapshot.currentSurface).toEqual({
      id: 'primary_screen_floor',
      kind: 'screen_floor',
      bounds: { x: -50, y: 30, width: 1600, height: 900 },
      supportY: 930,
      isValidSupport: true,
    });
  });

  it('publishes a fresh snapshot for display metrics changes and unsubscribes cleanly', () => {
    const adapter = new PlatformEnvironmentAdapter();
    const listener = vi.fn();
    const unsubscribe = adapter.onEnvironmentChanged(listener);
    const handler = electronMock.on.mock.calls.at(-1)?.[1] as (() => void) | undefined;

    expect(electronMock.on).toHaveBeenLastCalledWith('display-metrics-changed', expect.any(Function));
    expect(handler).toBeDefined();
    handler?.();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      screenBounds: expect.objectContaining({ id: 'primary_screen' }),
    }));

    unsubscribe();
    expect(electronMock.removeListener).toHaveBeenLastCalledWith('display-metrics-changed', handler);
  });
});
