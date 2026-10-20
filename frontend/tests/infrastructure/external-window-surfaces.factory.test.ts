import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import type { WindowsWindowSurfacesOptions } from '../../src/infrastructure/platform/windows-window-surfaces';
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), getPath: vi.fn(), dispose: vi.fn(), invalidate: vi.fn(), normalize: vi.fn(), on: vi.fn(), off: vi.fn(), screenOn: vi.fn(), screenOff: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: mocks.getPath }, screen: { on: mocks.screenOn, removeListener: mocks.screenOff, getAllDisplays: () => [{ bounds: { x: -1000, y: 0, width: 1000, height: 900 }, workArea: { x: -1000, y: 30, width: 1000, height: 870 } }] }, powerMonitor: { on: mocks.on, removeListener: mocks.off } }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs', () => ({ default: {
  existsSync: () => true, mkdtempSync: (prefix: string) => prefix + 'test', writeFileSync: vi.fn(), rmSync: vi.fn(),
} }));
vi.mock('../../src/infrastructure/platform/windows-window-surfaces', () => ({
  WindowsWindowSurfaces: class {
    constructor(options: WindowsWindowSurfacesOptions) { options.spawn(); mocks.normalize.mockImplementation(options.normalize); }
    invalidate = mocks.invalidate;
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
  it.each(['linux'])('is unavailable on %s arm64 without spawning or touching native display APIs', platform => {
    vi.stubGlobal('process', { ...process, platform, arch: 'arm64' });
    const port = createExternalWindowSurfaces();
    expect(port.getSnapshot()).toMatchObject({ capability: 'unavailable', reason: 'unsupported', surfaces: [] });
    expect(port.getSnapshot()).toBe(port.getSnapshot());
    port.dispose();
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(mocks.getPath).not.toHaveBeenCalled();
  });
});

describe('macOS helper launch', () => {
  it('uses the system JXA interpreter without a shell or permission commands', () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    mocks.getPath.mockReturnValue(path.resolve('temp'));
    const port = createExternalWindowSurfaces();
    expect(mocks.spawn).toHaveBeenCalledWith('/usr/bin/osascript',
      ['-l', 'JavaScript', path.join(path.resolve('temp'), 'wisp-surfaces-test', 'observe.js')],
      { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const bounds = { x: -800.5, y: 100, width: 200, height: 200 };
    expect(mocks.normalize([{ token: 'a'.repeat(32), ...bounds, top: true, left: false, right: false }])[0].bounds).toEqual(bounds);
    for (const event of ['suspend', 'resume', 'lock-screen', 'unlock-screen', 'user-did-resign-active', 'user-did-become-active']) {
      const listener = mocks.on.mock.calls.find(call => call[0] === event)?.[1];
      expect(listener).toBeTypeOf('function'); listener();
    }
    expect(mocks.invalidate).toHaveBeenCalledTimes(6);
    port.dispose();
    expect(mocks.off).toHaveBeenCalledTimes(6);
    expect(mocks.screenOff).toHaveBeenCalledTimes(3);
  });
});
