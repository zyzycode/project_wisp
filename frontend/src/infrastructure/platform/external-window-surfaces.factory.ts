import { app, screen, powerMonitor } from 'electron';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { ExternalWindowSurfacesPort, ExternalWindowSurfacesSnapshot } from '../../application/ports/external-window-surfaces.port';
import { normalizeBridgeWindows } from './window-surfaces-protocol';
import { WindowsWindowSurfaces } from './windows-window-surfaces';
import { MACOS_WINDOW_SURFACES_HELPER } from './macos-window-surfaces-helper';
import { WINDOW_SURFACES_HELPER_PS1 } from './window-surfaces-helper';

export class UnavailableWindowSurfaces implements ExternalWindowSurfacesPort {
  private readonly snapshot: ExternalWindowSurfacesSnapshot;
  public constructor(reason: 'unsupported' | 'bridge_failed' = 'unsupported') {
    this.snapshot = Object.freeze({ capability: 'unavailable', reason, capturedAtMs: 0, revision: 0, surfaces: Object.freeze([] as const) });
  }
  getSnapshot(): ExternalWindowSurfacesSnapshot { return this.snapshot; }
  subscribe(): () => void { return () => {}; }
  dispose(): void {}
}

/** All OS branches, filesystem/process operations and Electron DIP APIs stay here. */
export function createExternalWindowSurfaces(): ExternalWindowSurfacesPort {
  const mac = process.platform === 'darwin';
  if (!mac && process.platform !== 'win32') return new UnavailableWindowSurfaces();
  const systemRoot = process.env.SystemRoot;
  if (!mac && (systemRoot === undefined || !path.isAbsolute(systemRoot))) return new UnavailableWindowSurfaces('bridge_failed');
  const executable = mac ? '/usr/bin/osascript' : path.join(systemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const filename = mac ? 'observe.js' : 'observe.ps1';
  let directory: string;
  try {
    if (!fs.existsSync(executable)) return new UnavailableWindowSurfaces('bridge_failed');
    directory = fs.mkdtempSync(path.join(app.getPath('temp'), 'wisp-surfaces-'));
    fs.writeFileSync(path.join(directory, filename), mac ? MACOS_WINDOW_SURFACES_HELPER : WINDOW_SURFACES_HELPER_PS1, { encoding: 'utf8', mode: 0o600 });
  } catch { return new UnavailableWindowSurfaces('bridge_failed'); }
  let epoch = randomUUID();
  const port = new WindowsWindowSurfaces({
    now: () => performance.now(),
    spawn: () => {
      epoch = randomUUID();
      return spawn(executable, mac ? ['-l', 'JavaScript', path.join(directory, filename)] : ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(directory, 'observe.ps1')],
        { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    },
    ownProcessIds: () => [...new Set([process.pid, ...app.getAppMetrics().map(metric => metric.pid)])],
    normalize: windows => normalizeBridgeWindows(windows, screen.getAllDisplays().map(display => ({
      physicalBounds: mac ? display.bounds : screen.dipToScreenRect(null, display.bounds), workArea: display.workArea,
    })), bounds => mac ? bounds : screen.screenToDipRect(null, bounds), epoch),
  });
  const invalidate = (): void => port.invalidate();
  if (mac) {
    powerMonitor.on('suspend', invalidate); powerMonitor.on('resume', invalidate);
    powerMonitor.on('lock-screen', invalidate); powerMonitor.on('unlock-screen', invalidate);
    powerMonitor.on('user-did-resign-active', invalidate); powerMonitor.on('user-did-become-active', invalidate);
  }
  screen.on('display-added', invalidate); screen.on('display-removed', invalidate); screen.on('display-metrics-changed', invalidate);
  return {
    getSnapshot: () => port.getSnapshot(),
    subscribe: listener => port.subscribe(listener),
    dispose: () => {
      screen.removeListener('display-added', invalidate);
      screen.removeListener('display-removed', invalidate);
      screen.removeListener('display-metrics-changed', invalidate);
      if (mac) {
        powerMonitor.removeListener('suspend', invalidate); powerMonitor.removeListener('resume', invalidate);
        powerMonitor.removeListener('lock-screen', invalidate); powerMonitor.removeListener('unlock-screen', invalidate);
        powerMonitor.removeListener('user-did-resign-active', invalidate); powerMonitor.removeListener('user-did-become-active', invalidate);
      }
      port.dispose();
      try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* A shutting-down helper may still hold the script. */ }
    },
  };
}
