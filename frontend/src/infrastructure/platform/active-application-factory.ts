import { app, powerMonitor } from 'electron';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { ActiveApplicationObservationPort, ObservationApplication } from '../../application/ports/active-application-observation.port';
import { ActiveApplicationObserver } from './active-application-observer';
import { ObservationExecutableRegistry } from './active-application-management';
import { ACTIVE_APPLICATION_HELPER_PS1 } from './active-application-helper';

export interface ActiveApplicationObservationManagement {
  readonly port: ActiveApplicationObservationPort;
  registerExecutable(filename: string): ObservationApplication;
  forgetExecutable(appKey: string): void;
  clearExecutables(): void;
}
export function createActiveApplicationObservation(): ActiveApplicationObservationManagement {
  const registry = new ObservationExecutableRegistry(filename => {
    const canonical = fs.realpathSync.native(filename);
    if (!fs.statSync(canonical).isFile()) throw new Error('Invalid executable');
    return canonical;
  }, randomUUID);
  let directory: string | undefined;
  let disposed = false;
  const observer = new ActiveApplicationObserver({
    now: () => performance.now(), unsupported: process.platform !== 'win32',
    resolvePolicy: policy => registry.resolvePolicy(policy),
    ownProcessIds: () => [...new Set([process.pid, ...app.getAppMetrics().map(metric => metric.pid)])],
    spawn: () => {
      const systemRoot = process.env.SystemRoot;
      if (!systemRoot || !path.isAbsolute(systemRoot)) throw new Error('Observation unavailable');
      const executable = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      if (!fs.existsSync(executable)) throw new Error('Observation unavailable');
      if (!directory) {
        directory = fs.mkdtempSync(path.join(app.getPath('temp'), 'wisp-observation-'));
        fs.writeFileSync(path.join(directory, 'observe.ps1'), ACTIVE_APPLICATION_HELPER_PS1, { encoding: 'utf8', mode: 0o600 });
      }
      return spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(directory, 'observe.ps1')],
        { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    },
  });
  const pause = (): void => observer.pause();
  powerMonitor.on('lock-screen', pause); powerMonitor.on('suspend', pause);
  const port: ActiveApplicationObservationPort = {
    getSnapshot: () => observer.getSnapshot(), subscribe: listener => observer.subscribe(listener),
    replacePolicy: policy => observer.replacePolicy(policy), pause,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      powerMonitor.removeListener('lock-screen', pause); powerMonitor.removeListener('suspend', pause);
      observer.dispose(); registry.clearExecutables();
      if (directory) { try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* Helper shutdown may hold its script briefly. */ } }
    },
  };
  return {
    port,
    registerExecutable: filename => { if (disposed) throw new Error('Observation unavailable'); return registry.registerExecutable(filename); },
    forgetExecutable: appKey => { observer.pause(); registry.forgetExecutable(appKey); },
    clearExecutables: () => { observer.pause(); registry.clearExecutables(); },
  };
}
