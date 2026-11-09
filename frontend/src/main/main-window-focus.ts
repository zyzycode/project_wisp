import { dialog, powerMonitor } from 'electron';
import type { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import type { ExternalWindowComposition } from '../infrastructure/platform/external-window-surfaces.factory';
import type { WindowFocusRequestContext } from '../application/ports/external-window-focus.port';
import type { MemoryScheduler } from '../application/ports/memory-runtime';
import { WindowFocusRuntime } from '../application/services/window-focus-runtime';
interface Options {
  readonly windows: ExternalWindowComposition;
  readonly getWindow: () => BrowserWindow | null;
  readonly context: () => Omit<WindowFocusRequestContext, 'requestId'> | null;
  readonly active: () => boolean;
  readonly now: () => number;
  readonly scheduler: MemoryScheduler;
}
/** OS effects remain in Infrastructure; Main owns native consent and lifecycle. */
export class MainWindowFocus {
  public readonly runtime: WindowFocusRuntime;
  private blocked = false;
  private disposed = false;
  private readonly stop = () => { this.blocked = true; this.runtime.invalidate(); };
  private readonly resume = () => { this.blocked = false; this.runtime.invalidate(); };
  private readonly unsubscribe: () => void;
  constructor(options: Options) {
    this.runtime = new WindowFocusRuntime({ now: options.now, createId: randomUUID, scheduler: options.scheduler,
      context: options.context, active: () => !this.blocked && options.active(), port: options.windows.focus,
      capability: options.windows.focusCapability, candidates: options.windows.focusCandidates,
      confirm: async (preview, signal) => {
        const window = options.getWindow();
        if (!window || window.isDestroyed() || signal.aborted) return false;
        const percent = (n: number) => Math.round(n * 100);
        const result = await dialog.showMessageBox(window, { type: 'question', title: 'Показать выбранное окно',
          message: 'Переключить фокус на окно в выбранной области?',
          detail: `Область рабочего стола: слева ${percent(preview.left)}%, сверху ${percent(preview.top)}%, ширина ${percent(preview.width)}%, высота ${percent(preview.height)}%. Окно не будет перемещено или изменено. Windows может отклонить переключение.`,
          buttons: ['Отмена', 'Переключить фокус'], defaultId: 0, cancelId: 0, noLink: true, signal });
        return !signal.aborted && result.response === 1;
      },
    });
    this.unsubscribe = options.windows.surfaces.subscribe(() => this.runtime.revalidate());
    powerMonitor.on('lock-screen', this.stop); powerMonitor.on('suspend', this.stop); powerMonitor.on('user-did-resign-active', this.stop);
    powerMonitor.on('unlock-screen', this.resume); powerMonitor.on('resume', this.resume); powerMonitor.on('user-did-become-active', this.resume);
  }
  public invalidate(): void { this.runtime.invalidate(); }
  public dispose(): void {
    if (this.disposed) return; this.disposed = true; this.unsubscribe(); this.runtime.dispose();
    powerMonitor.removeListener('lock-screen', this.stop); powerMonitor.removeListener('suspend', this.stop); powerMonitor.removeListener('user-did-resign-active', this.stop);
    powerMonitor.removeListener('unlock-screen', this.resume); powerMonitor.removeListener('resume', this.resume); powerMonitor.removeListener('user-did-become-active', this.resume);
  }
}
