import type { IPlatformAdapter } from '../../application/ports/platform-adapter.interface';
import { LinuxPlatformAdapter } from './linux-platform.adapter';
import { WindowsPlatformAdapter } from './windows-platform.adapter';
import { MacOSPlatformAdapter } from './macos-platform.adapter';

export function createPlatformAdapter(): IPlatformAdapter {
  switch (process.platform) {
    case 'linux':
      return new LinuxPlatformAdapter();
    case 'win32':
      return new WindowsPlatformAdapter();
    case 'darwin':
      return new MacOSPlatformAdapter();
    default:
      console.warn(`[PlatformAdapterFactory] Unrecognized platform "${process.platform}", falling back to Linux adapter.`);
      return new LinuxPlatformAdapter();
  }
}
