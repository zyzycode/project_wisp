import { describe, expect, it, vi } from 'vitest';
import { startShimejiMotionLoop } from '../../src/main/shimeji-motion-loop';

describe('Main: Shimeji motion loop', () => {
  it('starts, publishes committed transitions, and stops when the window is destroyed', () => {
    let callback: (() => void) | undefined;
    const handle = {} as ReturnType<typeof setInterval>;
    const timer = {
      setInterval: vi.fn((next: () => void): ReturnType<typeof setInterval> => {
        callback = next;
        return handle;
      }),
      clearInterval: vi.fn(),
    };
    const orchestrator = { start: vi.fn(), stop: vi.fn(), tick: vi.fn(() => true) };
    const publishPresentation = vi.fn();
    const window = { isDestroyed: vi.fn(() => false) };
    const stop = startShimejiMotionLoop({
      orchestrator, getWindow: () => window, publishPresentation, intervalMs: 8, timer,
    });

    callback?.();
    window.isDestroyed.mockReturnValue(true);
    callback?.();
    stop();

    expect(orchestrator.start).toHaveBeenCalledOnce();
    expect(orchestrator.tick).toHaveBeenCalledOnce();
    expect(publishPresentation).toHaveBeenCalledOnce();
    expect(orchestrator.stop).toHaveBeenCalledOnce();
    expect(timer.clearInterval).toHaveBeenCalledOnce();
  });
});
