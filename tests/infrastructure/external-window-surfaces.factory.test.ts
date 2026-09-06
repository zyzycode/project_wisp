import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), getPath: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: mocks.getPath }, screen: {} }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
import { createExternalWindowSurfaces } from '../../src/infrastructure/platform/external-window-surfaces.factory';
describe('non-Windows external observation', () => {
  it.skipIf(process.platform === 'win32')('is unavailable without spawning or touching native display APIs', () => {
    const port = createExternalWindowSurfaces();
    expect(port.getSnapshot()).toMatchObject({ capability: 'unavailable', reason: 'unsupported', surfaces: [] });
    expect(port.getSnapshot()).toBe(port.getSnapshot());
    port.dispose();
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(mocks.getPath).not.toHaveBeenCalled();
  });
});
