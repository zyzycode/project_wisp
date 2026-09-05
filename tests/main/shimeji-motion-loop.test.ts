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
    const order: string[] = [];
    const orchestrator = {
      start: vi.fn(),
      stop: vi.fn(),
      tick: vi.fn(() => {
        order.push('tick');
        return true;
      }),
    };
    const publishPresentation = vi.fn(() => order.push('publish'));
    const beginPresentationTransaction = vi.fn(() => order.push('begin'));
    const commitPresentationTransaction = vi.fn(() => order.push('commit'));
    const window = { isDestroyed: vi.fn(() => false) };
    const stop = startShimejiMotionLoop({
      orchestrator,
      getWindow: () => window,
      publishPresentation,
      beginPresentationTransaction,
      commitPresentationTransaction,
      intervalMs: 8,
      timer,
    });

    callback?.();
    window.isDestroyed.mockReturnValue(true);
    callback?.();
    stop();

    expect(orchestrator.start).toHaveBeenCalledOnce();
    expect(orchestrator.tick).toHaveBeenCalledOnce();
    expect(publishPresentation).toHaveBeenCalledOnce();
    expect(beginPresentationTransaction).toHaveBeenCalledOnce();
    expect(commitPresentationTransaction).toHaveBeenCalledOnce();
    expect(order).toEqual(['begin', 'tick', 'publish', 'commit']);
    expect(orchestrator.stop).toHaveBeenCalledOnce();
    expect(timer.clearInterval).toHaveBeenCalledOnce();
  });

  it('closes the presentation transaction when a motion tick fails', () => {
    let callback: (() => void) | undefined;
    const timer = {
      setInterval: vi.fn((next: () => void): ReturnType<typeof setInterval> => {
        callback = next;
        return {} as ReturnType<typeof setInterval>;
      }),
      clearInterval: vi.fn(),
    };
    const commitPresentationTransaction = vi.fn();
    startShimejiMotionLoop({
      orchestrator: {
        start: vi.fn(),
        stop: vi.fn(),
        tick: vi.fn(() => {
          throw new Error('tick failed');
        }),
      },
      getWindow: () => ({ isDestroyed: () => false }),
      publishPresentation: vi.fn(),
      beginPresentationTransaction: vi.fn(),
      commitPresentationTransaction,
      intervalMs: 8,
      timer,
    });

    expect(() => callback?.()).toThrow('tick failed');
    expect(commitPresentationTransaction).toHaveBeenCalledOnce();
  });
});
