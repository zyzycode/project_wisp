import { describe, expect, it, vi } from 'vitest';
import {
  isInteractiveOverlayPoint,
  LatestAnimationFrameQueue,
  registerOverlayMouseListener,
  registerPetDragGlobalListeners,
  shouldIgnoreOverlayPointer,
} from '../../src/renderer/body-ui-runtime';

describe('Renderer: Body UI runtime', () => {
  it('coalesces drag movement latest-wins to at most one send per animation frame', () => {
    let nextFrameId = 0;
    const callbacks = new Map<number, (now: number) => void>();
    const scheduler = {
      request: vi.fn((callback: (now: number) => void) => {
        const id = ++nextFrameId;
        callbacks.set(id, callback);
        return id;
      }),
      cancel: vi.fn((id: number) => callbacks.delete(id)),
    };
    const emit = vi.fn();
    const queue = new LatestAnimationFrameQueue(scheduler, emit);

    for (let x = 1; x <= 1_000; x += 1) queue.push({ x });
    expect(scheduler.request).toHaveBeenCalledOnce();
    callbacks.get(1)?.(16);
    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith({ x: 1_000 });

    queue.push({ x: 4 });
    queue.dispose();
    expect(scheduler.cancel).toHaveBeenCalledWith(2);
    expect(emit).toHaveBeenCalledOnce();
  });

  it('removes the exact global drag and overlay listeners during cleanup', () => {
    const target = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const handlers = { move: vi.fn(), end: vi.fn(), cancel: vi.fn() };
    const removeDrag = registerPetDragGlobalListeners(target, handlers);
    const overlayListener = vi.fn();
    const removeOverlay = registerOverlayMouseListener(target, overlayListener);

    removeDrag();
    removeOverlay();

    expect(target.removeEventListener.mock.calls).toEqual(target.addEventListener.mock.calls);
  });

  it('distinguishes marked interactive surfaces from transparent overlay pixels', () => {
    const interactive = { closest: vi.fn(() => ({})) };
    const transparent = { closest: vi.fn(() => null) };

    expect(isInteractiveOverlayPoint({ elementFromPoint: () => interactive }, 1, 2))
      .toBe(true);
    expect(isInteractiveOverlayPoint({ elementFromPoint: () => transparent }, 1, 2))
      .toBe(false);
    expect(isInteractiveOverlayPoint({ elementFromPoint: () => null }, 1, 2)).toBe(false);
    expect(shouldIgnoreOverlayPointer(false, { elementFromPoint: () => transparent }, 1, 2))
      .toBe(true);
    expect(shouldIgnoreOverlayPointer(false, { elementFromPoint: () => interactive }, 1, 2))
      .toBe(false);
    expect(shouldIgnoreOverlayPointer(true, { elementFromPoint: () => transparent }, 1, 2))
      .toBe(false);
  });

});
