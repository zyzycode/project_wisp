import { afterEach, expect, it, vi } from 'vitest';
import { useGazeGeometry } from '../../src/renderer/hooks/useGazeGeometry';
import type { RenderPresentationState } from '../../src/renderer/render-engine/types';

const hooks = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }));
vi.mock('react', () => ({ useRef: <T,>(current: T) => ({ current }),
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: () => (() => void)) => { hooks.cleanup = effect(); },
}));
afterEach(() => { hooks.cleanup?.(); vi.unstubAllGlobals(); });

it('reads layout once for stable RAF samples and invalidates on resize or scroll', () => {
  const windowTarget = Object.assign(new EventTarget(), { screenX: -1200, screenY: 200 });
  vi.stubGlobal('window', windowTarget);
  let resized: (() => void) | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe() {} disconnect = disconnect;
  });
  const getBoundingClientRect = vi.fn(() => ({ width: 240, height: 240, left: 20, top: 30 }));
  const root = { current: { getBoundingClientRect } as HTMLDivElement };
  const state: RenderPresentationState = { viewport: { width: 512, height: 512 },
    rootPivot: { x: 256, y: 460 }, transform: { scale: 1, flipX: false }, layers: [] };
  const geometry = useGazeGeometry(root, state, { x: 256, y: 180 }, { width: 240, height: 240 });
  for (let frame = 0; frame < 60_000; frame++) geometry();
  expect(getBoundingClientRect).toHaveBeenCalledTimes(1);
  const before = geometry()!;
  windowTarget.screenX += 100;
  expect(geometry()!.rootGlobalPosition.x).toBe(before.rootGlobalPosition.x + 100);
  expect(getBoundingClientRect).toHaveBeenCalledTimes(1);
  resized?.(); geometry();
  windowTarget.dispatchEvent(new Event('scroll')); geometry();
  expect(getBoundingClientRect).toHaveBeenCalledTimes(3);
  hooks.cleanup?.(); hooks.cleanup = undefined;
  expect(disconnect).toHaveBeenCalledOnce();
});
