import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import type { WindowsWindowSurfacesOptions } from '../../src/infrastructure/platform/windows-window-surfaces';
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), getPath: vi.fn(), dispose: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: mocks.getPath }, screen: { on: vi.fn(), removeListener: vi.fn() } }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs', () => ({ default: {
  existsSync: () => true, mkdtempSync: (prefix: string) => prefix + 'test', writeFileSync: vi.fn(), rmSync: vi.fn(),
} }));
vi.mock('../../src/infrastructure/platform/windows-window-surfaces', () => ({
  WindowsWindowSurfaces: class {
    constructor(options: WindowsWindowSurfacesOptions) { options.spawn(); }
    dispose = mocks.dispose;
  },
}));
import { createExternalWindowSurfaces } from '../../src/infrastructure/platform/external-window-surfaces.factory';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('Windows helper launch security', () => {
  it('uses system PowerShell with fixed file arguments and inherits execution policy', () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    vi.stubEnv('SystemRoot', path.resolve('Windows'));
    mocks.getPath.mockReturnValue(path.resolve('temp'));
    const port = createExternalWindowSurfaces();
    expect(mocks.spawn).toHaveBeenCalledWith(
      path.join(path.resolve('Windows'), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(path.resolve('temp'), 'wisp-surfaces-test', 'observe.ps1')],
      { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    port.dispose();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
describe('non-Windows external observation', () => {
  it.skipIf(process.platform === 'win32')('is unavailable without spawning or touching native display APIs', () => {
    const port = createExternalWindowSurfaces();
    expect(port.getSnapshot()).toMatchObject({ capability: 'unavailable', reason: 'unsupported', surfaces: [] });
    expect(port.getSnapshot()).toBe(port.getSnapshot());
    port.dispose();
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(mocks.getPath).not.toHaveBeenCalled();
  });
});
