import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GazeEngine } from '../../src/domain/behavior/gaze-engine';
import { useGaze, type UseGazeOptions } from '../../src/renderer/hooks/useGaze';

const hooks = vi.hoisted(() => ({ refs: [] as { current: unknown }[], index: 0,
  dependencies: undefined as readonly unknown[] | undefined,
  cleanup: undefined as (() => void) | undefined }));
vi.mock('react', () => ({
  useRef: <T,>(initial: T): { current: T } => {
    const index = hooks.index++; hooks.refs[index] ??= { current: initial };
    return hooks.refs[index] as { current: T };
  },
  useEffect: (effect: () => (() => void) | undefined, dependencies: readonly unknown[]) => {
    if (hooks.dependencies?.every((value, index) => Object.is(value, dependencies[index]))) return;
    hooks.cleanup?.(); hooks.dependencies = dependencies; hooks.cleanup = effect();
  },
}));

let now = 0, frameId = 0;
let frames: Map<number, (time: number) => void>;
let pointer: EventTarget, visibility: EventTarget;
let cancelFrame: ReturnType<typeof vi.fn>;
const geometry = { rootGlobalPosition: { x: 0, y: 0 }, gazeOriginSourcePx: { x: 0, y: 0 }, scale: 1, flipX: false };

beforeEach(() => {
  hooks.refs = []; hooks.index = 0; hooks.dependencies = undefined; hooks.cleanup = undefined;
  now = 0; frameId = 0; frames = new Map();
  pointer = new EventTarget(); visibility = new EventTarget();
  vi.useFakeTimers(); vi.spyOn(performance, 'now').mockImplementation(() => now);
  cancelFrame = vi.fn((id: number) => frames.delete(id));
  vi.stubGlobal('window', Object.assign(pointer, {
    requestAnimationFrame: (callback: (time: number) => void) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: cancelFrame,
    setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
  }));
  vi.stubGlobal('document', Object.assign(visibility, { hidden: false }));
});
afterEach(() => {
  hooks.cleanup?.(); hooks.cleanup = undefined;
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
function render(options: Partial<UseGazeOptions> = {}) {
  hooks.index = 0; const direction = vi.fn();
  useGaze({ enabled: true, getGeometry: () => geometry, onGazeDirection: direction, ...options });
  return direction;
}
function tick(time: number): void {
  now = time; const pending = [...frames.values()]; frames.clear();
  for (const callback of pending) callback(time);
}
function move(x: number, y: number): void {
  pointer.dispatchEvent(Object.assign(new Event('mousemove'), { screenX: x, screenY: y }));
}

it('tracks the global cursor without local movement and retains it after pointerleave', () => {
  const direction = render({ globalCursor: { globalPosition: { x: 180, y: 0 }, capturedAtMs: 0 } });
  tick(0); tick(100); expect(direction).toHaveBeenLastCalledWith('right');
  move(-180, 0); pointer.dispatchEvent(new Event('pointerleave')); tick(200);
  expect(direction).toHaveBeenLastCalledWith('right');
});
it('preserves source sample age across RAF and returns to neutral when it expires', () => {
  const update = vi.spyOn(GazeEngine.prototype, 'update');
  const sample = { globalPosition: { x: 180, y: 0 }, capturedAtMs: 0 };
  const direction = render({ globalCursor: sample });
  tick(0); tick(100); tick(200); expect(direction).toHaveBeenLastCalledWith('right');
  tick(400); tick(1000); expect(direction).toHaveBeenLastCalledWith('neutral');
  for (const [, input] of update.mock.calls) expect(input.target).toEqual({ type: 'cursor', sample });
});
it('disables gaze and releases RAF, listeners and stationary cursor refresh', () => {
  const observed = vi.fn();
  render({ onCursorObserved: observed }); move(180, 0); tick(0); tick(100);
  const remove = vi.spyOn(pointer, 'removeEventListener');
  const direction = render({ enabled: false, onCursorObserved: observed });
  expect(direction).toHaveBeenLastCalledWith('neutral');
  expect(frames.size).toBe(0); expect(cancelFrame).toHaveBeenCalled();
  expect(remove).toHaveBeenCalledTimes(3);
  const count = observed.mock.calls.length;
  move(-180, 0); vi.advanceTimersByTime(1000); tick(200);
  expect(observed).toHaveBeenCalledTimes(count); expect(direction).toHaveBeenCalledOnce();
});
it('keeps gaze active while reactions are disabled and enables observations independently', () => {
  const observed = vi.fn();
  const direction = render({ observationEnabled: false, onCursorObserved: observed });
  move(180, 0); tick(0); tick(100);
  expect(direction).toHaveBeenLastCalledWith('right'); expect(observed).not.toHaveBeenCalled();
  render({ observationEnabled: true, onCursorObserved: observed }); move(200, 0);
  now = 200; vi.advanceTimersByTime(100);
  expect(observed).toHaveBeenLastCalledWith({ x: 200, y: 0 }); expect(frames.size).toBe(1);
});
it('clears old stream gaze and replaces listeners and RAF before accepting the next stream', () => {
  const observed = vi.fn();
  render({ observationLifecycleKey: 'old', onCursorObserved: observed });
  move(180, 0); tick(0); tick(100);
  const remove = vi.spyOn(pointer, 'removeEventListener');
  const visibilityRemove = vi.spyOn(visibility, 'removeEventListener');
  const direction = render({ observationLifecycleKey: 'new', globalCursor: null, onCursorObserved: observed });
  expect(cancelFrame).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledTimes(3);
  expect(visibilityRemove).toHaveBeenCalledOnce(); expect(frames.size).toBe(1);
  tick(200); expect(direction).toHaveBeenLastCalledWith('neutral');
  const count = observed.mock.calls.length;
  vi.advanceTimersByTime(1000); expect(observed).toHaveBeenCalledTimes(count);
  hooks.cleanup?.(); hooks.cleanup = undefined;
  expect(frames.size).toBe(0); expect(remove).toHaveBeenCalledTimes(6);
  expect(visibilityRemove).toHaveBeenCalledTimes(2);
  move(180, 0); vi.advanceTimersByTime(1000); expect(observed).toHaveBeenCalledTimes(count);
});
it('does not duplicate global observations through the local feedback path', () => {
  const observed = vi.fn();
  render({ globalCursor: { globalPosition: { x: 180, y: 0 }, capturedAtMs: 0 }, onCursorObserved: observed });
  move(200, 0); vi.advanceTimersByTime(1000); expect(observed).not.toHaveBeenCalled();
});

it('does not refresh local sample age from RAF when the presence timer has not fired', () => {
  const update = vi.spyOn(GazeEngine.prototype, 'update');
  const direction = render();
  move(180, 0); tick(0); tick(100); tick(200);
  expect(direction).toHaveBeenLastCalledWith('right');
  tick(400); tick(1000);
  expect(direction).toHaveBeenLastCalledWith('neutral');
  for (const [, input] of update.mock.calls) expect(input.target).toEqual({
    type: 'cursor', sample: { globalPosition: { x: 180, y: 0 }, capturedAtMs: 0 },
  });
});

it('does not revive the local cursor when global input disappears after pointerleave', () => {
  const update = vi.spyOn(GazeEngine.prototype, 'update');
  render({ globalCursor: { globalPosition: { x: 180, y: 0 }, capturedAtMs: 0 } });
  move(-180, 0); tick(0); tick(100);
  pointer.dispatchEvent(new Event('pointerleave'));
  const direction = render({ globalCursor: null });
  tick(200); tick(1000);
  expect(update.mock.calls.at(-1)?.[1].target).toEqual({ type: 'neutral' });
  expect(direction).toHaveBeenLastCalledWith('neutral');
});

it('forwards the smoothed fractional offset to the pupil renderer, independently of discrete direction', () => {
  const offset = vi.fn();
  render({ onGazeOffset: offset, globalCursor: { globalPosition: { x: 180, y: 0 }, capturedAtMs: 0 } });
  tick(0); tick(16);
  const first = offset.mock.calls.at(-1)?.[0];
  expect(first.x).toBeGreaterThan(0); expect(first.x).toBeLessThan(1);
  tick(32);
  expect(offset.mock.calls.at(-1)?.[0].x).toBeGreaterThan(first.x);
  render({ enabled: false, onGazeOffset: offset });
  expect(offset).toHaveBeenLastCalledWith({ x: 0, y: 0 });
});
