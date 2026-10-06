import { afterEach, expect, it, vi } from 'vitest';
import { screen } from 'electron';
import { WindowsPlatformAdapter } from '../../src/infrastructure/platform/windows-platform.adapter';
import { MacOSPlatformAdapter } from '../../src/infrastructure/platform/macos-platform.adapter';
import { LinuxPlatformAdapter } from '../../src/infrastructure/platform/linux-platform.adapter';

vi.mock('electron', () => ({ screen: { getCursorScreenPoint: vi.fn() }, BrowserWindow: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
it.each([new WindowsPlatformAdapter(), new MacOSPlatformAdapter(), new LinuxPlatformAdapter()])('reads global DIP without scaling twice', adapter => {
  vi.stubEnv('XDG_SESSION_TYPE', 'x11');
  vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: -1500, y: 700 });
  expect(adapter.getCursorScreenPosition()).toEqual({ x: -1500, y: 700 });
});
it('reports unsupported Wayland without inventing a zero position', () => {
  vi.stubEnv('XDG_SESSION_TYPE', 'wayland');
  expect(new LinuxPlatformAdapter().getCursorScreenPosition()).toBeNull();
  expect(screen.getCursorScreenPoint).not.toHaveBeenCalled();
});
it('reports API failures and malformed coordinates as unavailable', () => {
  const adapter = new WindowsPlatformAdapter();
  vi.mocked(screen.getCursorScreenPoint).mockImplementation(() => { throw new Error('unavailable'); });
  expect(adapter.getCursorScreenPosition()).toBeNull();
  vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: NaN, y: 0 });
  expect(adapter.getCursorScreenPosition()).toBeNull();
});
