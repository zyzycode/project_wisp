import { app, screen, powerMonitor } from 'electron';
import { spawn } from 'node:child_process';
import type { ExternalWindowFocusPort, WindowFocusCandidate } from '../../application/ports/external-window-focus.port';
import { WindowsWindowFocus, unsupportedWindowFocus } from './windows-window-focus';
import { focusSurfaceSignature, type FocusBridgeTarget } from './window-focus-protocol';
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

export interface ExternalWindowComposition {
  readonly surfaces: ExternalWindowSurfacesPort;
  readonly focus: ExternalWindowFocusPort;
  readonly focusCapability: () => 'available' | 'unavailable' | 'unsupported';
  readonly focusCandidates: (policyGeneration: number) => readonly WindowFocusCandidate[];
}
const unavailableComposition = (reason: 'unsupported' | 'bridge_failed' = 'unsupported'): ExternalWindowComposition => ({
  surfaces: new UnavailableWindowSurfaces(reason), focus: unsupportedWindowFocus(),
  focusCapability: () => reason === 'unsupported' ? 'unsupported' : 'unavailable', focusCandidates: () => [],
});
/** Existing read-only consumers receive no action capability. */
export function createExternalWindowSurfaces(): ExternalWindowSurfacesPort { return createExternalWindowComposition().surfaces; }
/** All OS branches, filesystem/process operations and Electron DIP APIs stay here. */
export function createExternalWindowComposition(): ExternalWindowComposition {
  const mac = process.platform === 'darwin';
  if (!mac && process.platform !== 'win32') return unavailableComposition();
  const systemRoot = process.env.SystemRoot;
  if (!mac && (systemRoot === undefined || !path.isAbsolute(systemRoot))) return unavailableComposition('bridge_failed');
  const executable = mac ? '/usr/bin/osascript' : path.join(systemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const filename = mac ? 'observe.js' : 'observe.ps1';
  let directory: string;
  try {
    if (!fs.existsSync(executable)) return unavailableComposition('bridge_failed');
    directory = fs.mkdtempSync(path.join(app.getPath('temp'), 'wisp-surfaces-'));
    fs.writeFileSync(path.join(directory, filename), mac ? MACOS_WINDOW_SURFACES_HELPER : WINDOW_SURFACES_HELPER_PS1, { encoding: 'utf8', mode: 0o600 });
  } catch { return unavailableComposition('bridge_failed'); }
  let epoch = randomUUID();
  const focusTargets = new Map<string, FocusBridgeTarget>();
  const port = new WindowsWindowSurfaces({
    now: () => performance.now(),
    spawn: () => {
      epoch = randomUUID();
      return spawn(executable, mac ? ['-l', 'JavaScript', path.join(directory, filename)] : ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(directory, 'observe.ps1')],
        { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    },
    ownProcessIds: () => [...new Set([process.pid, ...app.getAppMetrics().map(metric => metric.pid)])],
    normalize: windows => {
      focusTargets.clear();
      const displays = screen.getAllDisplays().map(display => ({ physicalBounds: mac ? display.bounds : screen.dipToScreenRect(null, display.bounds), workArea: display.workArea }));
      return Object.freeze(windows.flatMap(window => {
        const normalized = normalizeBridgeWindows([window], displays, bounds => mac ? bounds : screen.screenToDipRect(null, bounds), epoch);
        if (!mac) for (const surface of normalized) focusTargets.set(surface.id, { token: window.token,
          signature: focusSurfaceSignature(surface), x: window.x, y: window.y, width: window.width, height: window.height });
        return normalized;
      }));
    },
  });
  const focus = mac ? unsupportedWindowFocus() : new WindowsWindowFocus({
    now: () => performance.now(), createId: () => randomUUID().replaceAll('-', ''), generation: () => port.actionGeneration(),
    lookup: id => port.getSnapshot().capability === 'available' ? focusTargets.get(id) : undefined,
    exchange: (command, signal) => port.exchangeFocus(command, signal),
  });
  const invalidate = (): void => { focusTargets.clear(); port.invalidate(); };
  {
    powerMonitor.on('suspend', invalidate); powerMonitor.on('resume', invalidate);
    powerMonitor.on('lock-screen', invalidate); powerMonitor.on('unlock-screen', invalidate);
    powerMonitor.on('user-did-resign-active', invalidate); powerMonitor.on('user-did-become-active', invalidate);
  }
  screen.on('display-added', invalidate); screen.on('display-removed', invalidate); screen.on('display-metrics-changed', invalidate);
  const surfaces: ExternalWindowSurfacesPort = {
    getSnapshot: () => port.getSnapshot(),
    subscribe: listener => port.subscribe(listener),
    dispose: () => {
      screen.removeListener('display-added', invalidate);
      screen.removeListener('display-removed', invalidate);
      screen.removeListener('display-metrics-changed', invalidate);
      {
        powerMonitor.removeListener('suspend', invalidate); powerMonitor.removeListener('resume', invalidate);
        powerMonitor.removeListener('lock-screen', invalidate); powerMonitor.removeListener('unlock-screen', invalidate);
        powerMonitor.removeListener('user-did-resign-active', invalidate); powerMonitor.removeListener('user-did-become-active', invalidate);
      }
      focus.dispose(); focusTargets.clear(); port.dispose();
      try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* A shutting-down helper may still hold the script. */ }
    },
  };
  return { surfaces, focus,
    focusCapability: () => mac ? 'unsupported' : port.getSnapshot().capability,
    focusCandidates: policyGeneration => {
      const snapshot = port.getSnapshot();
      if (mac || snapshot.capability !== 'available') return [];
      const displays = screen.getAllDisplays();
      if (!displays.length) return [];
      const left = Math.min(...displays.map(d => d.bounds.x)), top = Math.min(...displays.map(d => d.bounds.y));
      const right = Math.max(...displays.map(d => d.bounds.x + d.bounds.width)), bottom = Math.max(...displays.map(d => d.bounds.y + d.bounds.height));
      const seen = new Set<string>();
      return snapshot.surfaces.flatMap(surface => {
        const native = focusTargets.get(surface.id);
        if (!native || seen.has(native.token)) return []; seen.add(native.token);
        const x = Math.max(left, surface.bounds.x), y = Math.max(top, surface.bounds.y);
        const width = Math.min(right, surface.bounds.x + surface.bounds.width) - x, height = Math.min(bottom, surface.bounds.y + surface.bounds.height) - y;
        if (width <= 0 || height <= 0) return [];
        return [{ target: { surfaceId: surface.id, sourceEpoch: port.actionGeneration(), policyGeneration,
          geometrySignature: native.signature, capturedAtMs: snapshot.capturedAtMs },
          preview: { left: (x-left)/(right-left), top: (y-top)/(bottom-top), width: width/(right-left), height: height/(bottom-top) } }];
      }).slice(0, 20);
    },
  };
}
