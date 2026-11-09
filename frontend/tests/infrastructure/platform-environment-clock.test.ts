import { beforeEach, expect, it, vi } from 'vitest';
import { PlatformEnvironmentAdapter } from '../../src/infrastructure/platform/platform-environment.adapter';
import { hasBookSupport } from '../../src/domain/behavior/book-activity';

const nativeClock = vi.hoisted(() => ({ now: 100.25 }));
vi.mock('node:perf_hooks', () => ({ performance: { now: () => nativeClock.now } }));
vi.mock('electron', () => {
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1000, height: 800 } };
  return { screen: { getPrimaryDisplay: () => display, getDisplayNearestPoint: () => display } };
});
const root = { x: 500, y: 790 };
const insets = { left: 50, right: 50, top: 90, bottom: 10 };
beforeEach(() => { nativeClock.now = 100.25; });

it('uses the shared frozen Main capture clock rather than sampling geometry in its future', () => {
  const frameTime = 100;
  const adapter = new PlatformEnvironmentAdapter(() => frameTime);
  const environment = adapter.getSnapshot(root);
  expect(environment.capturedAtMs).toBe(frameTime);
  expect(hasBookSupport(environment, root, insets, frameTime)).toBe(true);
});

it('keeps genuine future and stale samples rejected under the same capture clock', () => {
  let frameTime = 100;
  const adapter = new PlatformEnvironmentAdapter(() => frameTime);
  adapter.getSnapshot(root);
  frameTime = 110;
  const environment = adapter.getSnapshot(root);
  expect(environment.capturedAtMs).toBe(110);
  expect(hasBookSupport({ ...environment, capturedAtMs: 110.1 }, root, insets, frameTime)).toBe(false);
  expect(hasBookSupport({ ...environment, capturedAtMs: -191 }, root, insets, frameTime)).toBe(false);
});

it('preserves the existing native performance clock for standalone adapters', () => {
  expect(new PlatformEnvironmentAdapter().getSnapshot(root).capturedAtMs).toBe(100.25);
});
