import { app, screen } from 'electron';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { ExternalWindowSurfacesPort, ExternalWindowSurfacesSnapshot } from '../../application/ports/external-window-surfaces.port';
import { normalizeBridgeWindows } from './window-surfaces-protocol';
import { WindowsWindowSurfaces } from './windows-window-surfaces';
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
  if (process.platform !== 'win32') return new UnavailableWindowSurfaces();
  const systemRoot = process.env.SystemRoot;
  if (systemRoot === undefined || !path.isAbsolute(systemRoot)) return new UnavailableWindowSurfaces('bridge_failed');
  const executable = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  let directory: string;
  try {
    if (!fs.existsSync(executable)) return new UnavailableWindowSurfaces('bridge_failed');
    directory = fs.mkdtempSync(path.join(app.getPath('temp'), 'wisp-surfaces-'));
    fs.writeFileSync(path.join(directory, 'observe.ps1'), WINDOW_SURFACES_HELPER_PS1, { encoding: 'utf8', mode: 0o600 });
  } catch { return new UnavailableWindowSurfaces('bridge_failed'); }
  let epoch = randomUUID();
  const port = new WindowsWindowSurfaces({
    now: () => performance.now(),
    spawn: () => {
      epoch = randomUUID();
      return spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(directory, 'observe.ps1')],
        { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    },
    ownProcessIds: () => [...new Set([process.pid, ...app.getAppMetrics().map(metric => metric.pid)])],
    normalize: windows => normalizeBridgeWindows(windows, screen.getAllDisplays().map(display => ({
      physicalBounds: screen.dipToScreenRect(null, display.bounds), workArea: display.workArea,
    })), bounds => screen.screenToDipRect(null, bounds), epoch),
  });
  const invalidate = (): void => port.invalidate();
  screen.on('display-added', invalidate); screen.on('display-removed', invalidate); screen.on('display-metrics-changed', invalidate);
  return {
    getSnapshot: () => port.getSnapshot(), subscribe: listener => port.subscribe(listener),
    dispose: () => {
      screen.removeListener('display-added', invalidate); screen.removeListener('display-removed', invalidate); screen.removeListener('display-metrics-changed', invalidate);
      port.dispose();
      try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* A shutting-down helper may still hold the script. */ }
    },
  };
}
