import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { WINDOW_SURFACES_HELPER_PS1 } from '../../src/infrastructure/platform/window-surfaces-helper';
import { WindowsWindowSurfaces } from '../../src/infrastructure/platform/windows-window-surfaces';
import { normalizeBridgeWindows, type SurfaceDisplay } from '../../src/infrastructure/platform/window-surfaces-protocol';
import { ShimejiMotionOrchestrator } from '../../src/application/services/shimeji-motion-orchestrator';
import { MotionEngine } from '../../src/domain/behavior/motion-engine';
import { SurfaceKinematics } from '../../src/domain/behavior/surface-kinematics';

// Explicit interactive integration gate. Unit runs never open windows or use real timers.
it.skipIf(process.env.WISP_NATIVE_SMOKE !== '1')('native Win32 → live observer → release → landing on an off-desktop-bottom window', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wisp-native-landing-'));
  const fixturePath = path.join(directory, 'fixture.cjs');
  const helperPath = path.join(directory, 'observe.ps1');
  writeFileSync(helperPath, WINDOW_SURFACES_HELPER_PS1);
  writeFileSync(fixturePath, `
const {app,BrowserWindow,screen}=require('electron');
app.setPath('userData',__dirname);
app.whenReady().then(async()=>{
 const d=screen.getPrimaryDisplay();
 const w=new BrowserWindow({x:d.workArea.x+180,y:d.workArea.y+300,width:900,height:d.bounds.height,
  show:false,alwaysOnTop:true,title:'Wisp native landing fixture',
  webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
 await w.loadURL('data:text/html,<title>Wisp native landing fixture</title><p>Temporary landing test. Closes automatically.</p>');
 w.show();
 console.log('WISP_FIXTURE='+JSON.stringify({pid:process.pid,fixtureBounds:w.getBounds(),workArea:d.workArea,displays:screen.getAllDisplays().map(s=>({physicalBounds:screen.dipToScreenRect(null,s.bounds),workArea:s.workArea}))}));
});
app.on('window-all-closed',()=>app.quit());
  `);
  let fixture: ChildProcessWithoutNullStreams | undefined;
  let port: WindowsWindowSurfaces | undefined;
  let motion: ShimejiMotionOrchestrator | undefined;
  try {
    const executable: unknown = createRequire(import.meta.url)('electron');
    if (typeof executable !== 'string') throw new Error('Electron executable unavailable');
    const fixtureEnv = { ...process.env };
    delete fixtureEnv.ELECTRON_RUN_AS_NODE;
    // This process is the explicitly visible blank test window, not the background helper.
    fixture = spawn(executable, [fixturePath], { shell: false, windowsHide: false, env: fixtureEnv });
    let fixtureError = '';
    fixture.stderr.on('data', chunk => { fixtureError += String(chunk); });
    const lines = createInterface({ input: fixture.stdout });
    const line = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Fixture timeout: ${fixtureError}`)), 10000);
      lines.on('line', value => {
        if (value.startsWith('WISP_FIXTURE=')) { clearTimeout(timer); resolve(value.slice('WISP_FIXTURE='.length)); }
      });
      fixture!.once('exit', () => { clearTimeout(timer); reject(new Error(`Fixture exited: ${fixtureError}`)); });
      fixture!.once('error', error => { clearTimeout(timer); reject(error); });
    });
    lines.close();
    // Trusted fixture emits only display geometry from Electron, no external window metadata.
    const displayInfo: { readonly workArea: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }; readonly displays: readonly SurfaceDisplay[] } = JSON.parse(String(line));
    const workArea = displayInfo.workArea;
    if (displayInfo.displays.length !== 1) throw new Error('This smoke fixture requires one display');
    if (displayInfo.displays[0]!.physicalBounds.width !== workArea.width) throw new Error('This smoke fixture requires 100% DPI');
    const systemRoot = process.env.SystemRoot;
    if (systemRoot === undefined) throw new Error('Windows SystemRoot unavailable');
    port = new WindowsWindowSurfaces({ now: Date.now, ownProcessIds: () => [process.pid],
      spawn: () => spawn(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helperPath], { shell: false, windowsHide: true }),
      normalize: rows => normalizeBridgeWindows(rows, displayInfo.displays, bounds => bounds, 'native-smoke'),
    });
    const deadline = Date.now() + 10000;
    let top = port.getSnapshot().surfaces.find(s => s.kind === 'window_top' && s.bounds.y >= workArea.y + 280);
    while (top === undefined && Date.now() < deadline) {
      await delay(50);
      top = port.getSnapshot().surfaces.find(s => s.kind === 'window_top' && s.bounds.y >= workArea.y + 280
        && s.bounds.y + s.bounds.height > workArea.y + workArea.height);
    }
    if (top?.kind !== 'window_top') throw new Error(`Native helper did not publish the fixture top: ${line}; capability=${port.getSnapshot().capability}`);
    const bounds = { id: 'primary', ...workArea };
    const root = { x: top.bounds.x + 150, y: top.supportY - 60 };
    const events: string[] = [];
    motion = new ShimejiMotionOrchestrator({
      initialMotion: { phase: 'grounded', position: root, velocityPxPerSec: { x: 0, y: 0 }, activeBoundsId: bounds.id, airborneElapsedSec: 0, peakGroundImpactSeverity: 0 },
      initialSurface: { phase: 'grounded', updatedAtMs: Date.now(), locomotionVelocityPxPerSec: { x: 0, y: 0 } },
      now: Date.now, motionEngine: new MotionEngine(), surfaceKinematics: new SurfaceKinematics(), externalWindows: port,
      environment: () => ({ capturedAtMs: Date.now(), screenBounds: bounds, currentSurface: { id: 'floor', kind: 'screen_floor', bounds, isValidSupport: true } }),
      positionPort: { commitRootPosition: () => {} },
      eventDispatcher: { dispatchMotionEvent: e => events.push(e.type), dispatchSurfaceEvent: e => events.push(e.type) },
    });
    motion.start();
    const dragSessionId = motion.beginDrag({ pointerId: 1, sequence: 0, screenPosition: root })!;
    await delay(20); motion.tick();
    motion.releaseDrag({ pointerId: 1, sequence: 1, dragSessionId, screenPosition: root });
    for (let i = 0; i < 100; i++) { await delay(10); motion.tick(); }
    expect(motion.getSurfaceState().externalAttachment?.surface.id).toBe(top.id);
    expect(motion.getMotionState().position).toEqual({ x: root.x, y: top.supportY });
    expect(events.filter(e => e === 'landed')).toHaveLength(1);
    expect(events).not.toContain('support_lost');
  } finally {
    motion?.stop(); port?.dispose();
    if (fixture !== undefined && fixture.exitCode === null) {
      fixture.kill(); await once(fixture, 'exit').catch(() => {});
    }
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
