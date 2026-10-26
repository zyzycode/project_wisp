import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CharacterRenderer } from '../../src/renderer/components/Character/CharacterRenderer';

const hooks = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[], setState: vi.fn() }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useRef: <T,>(current: T) => ({ current }),
  useState: <T,>(initial: T | (() => T)) => [typeof initial === 'function' ? (initial as () => T)() : initial, hooks.setState],
  useMemo: <T,>(create: () => T) => create(),
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));
vi.mock('../../src/renderer/hooks/useCharacterAnimation', () => ({ useCharacterAnimation: () => undefined }));
vi.mock('../../src/renderer/hooks/useGaze', () => ({ useGaze() {} }));
vi.mock('../../src/renderer/hooks/useGazeGeometry', () => ({ useGazeGeometry: () => () => undefined }));

beforeEach(() => { hooks.effects = []; hooks.setState.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); });
const flush = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };

it('loads mixed-format artist manifest without eagerly requesting every sprite frame', async () => {
  const manifest: unknown = JSON.parse(readFileSync('public/assets/sprites/manifest.json', 'utf8'));
  const image = vi.fn(function () { return { src: '' }; });
  vi.stubGlobal('Image', image);
  const fetchManifest = vi.fn(async () => ({ ok: true, json: async () => manifest }));
  vi.stubGlobal('fetch', fetchManifest);
  CharacterRenderer({});
  const cleanups = hooks.effects.map(effect => effect());
  await flush();
  expect(fetchManifest).toHaveBeenCalledOnce();
  expect(hooks.setState).toHaveBeenCalledOnce();
  expect(image).not.toHaveBeenCalled();
  for (const cleanup of cleanups) cleanup?.();
});

it('does not retain a late manifest in component state after unmount', async () => {
  let resolve!: (response: { ok: boolean; json: () => Promise<unknown> }) => void;
  vi.stubGlobal('fetch', () => new Promise(yes => { resolve = yes; }));
  CharacterRenderer({});
  const cleanups = hooks.effects.map(effect => effect());
  for (const cleanup of cleanups) cleanup?.();
  resolve({ ok: true, json: async () => ({}) });
  await flush();
  expect(hooks.setState).not.toHaveBeenCalled();
});
