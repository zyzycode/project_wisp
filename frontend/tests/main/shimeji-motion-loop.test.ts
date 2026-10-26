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
    const advanceBrain = vi.fn(() => {
      order.push('brain');
      return true;
    });
    const beginPresentationTransaction = vi.fn(() => order.push('begin'));
    const commitPresentationTransaction = vi.fn(() => order.push('commit'));
    const window = { isDestroyed: vi.fn(() => false) };
    const stop = startShimejiMotionLoop({
      orchestrator,
      getWindow: () => window,
      advanceBrain,
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
    expect(advanceBrain).toHaveBeenCalledOnce();
    expect(order).toEqual(['begin', 'tick', 'brain', 'publish', 'commit']);
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

it('retains the same interval for background sampling without motion, Brain or presentation', () => {
  let callback: (() => void) | undefined, live = true;
  const timer = { setInterval: vi.fn((next: () => void) => { callback = next; return {} as ReturnType<typeof setInterval>; }), clearInterval: vi.fn() };
  const orchestrator = { start: vi.fn(), stop: vi.fn(), tick: vi.fn(() => false) };
  const advanceBrain = vi.fn(), advanceBackgroundSampling = vi.fn(), publishPresentation = vi.fn(), beginPresentationTransaction = vi.fn();
  const stop = startShimejiMotionLoop({ orchestrator, getWindow: () => live ? { isDestroyed: () => false } : null,
    advanceBrain, advanceBackgroundSampling, publishPresentation, beginPresentationTransaction, intervalMs: 8, timer });
  callback?.(); live = false; callback?.(); callback?.();
  expect(timer.setInterval).toHaveBeenCalledOnce(); expect(timer.clearInterval).not.toHaveBeenCalled();
  expect(orchestrator.tick).toHaveBeenCalledOnce(); expect(advanceBrain).toHaveBeenCalledOnce(); expect(beginPresentationTransaction).toHaveBeenCalledOnce();
  expect(advanceBackgroundSampling).toHaveBeenCalledTimes(2); expect(publishPresentation).not.toHaveBeenCalled();
  stop(); stop(); callback?.(); expect(timer.clearInterval).toHaveBeenCalledOnce(); expect(advanceBackgroundSampling).toHaveBeenCalledTimes(2);
});
it('headless reset/resume can start a sampling-only interval without starting Motion', () => {
  let callback: (() => void) | undefined;
  const timer = { setInterval: vi.fn((next: () => void) => { callback = next; return {} as ReturnType<typeof setInterval>; }), clearInterval: vi.fn() };
  const orchestrator = { start: vi.fn(), stop: vi.fn(), tick: vi.fn(() => true) }, advanceBrain = vi.fn(), publishPresentation = vi.fn(), background = vi.fn();
  const stop = startShimejiMotionLoop({ orchestrator, getWindow: () => null, advanceBackgroundSampling: background, advanceBrain, publishPresentation, intervalMs: 8, timer });
  callback?.(); expect(background).toHaveBeenCalledOnce(); expect(orchestrator.start).not.toHaveBeenCalled(); expect(orchestrator.tick).not.toHaveBeenCalled();
  expect(advanceBrain).not.toHaveBeenCalled(); expect(publishPresentation).not.toHaveBeenCalled(); stop();
});
