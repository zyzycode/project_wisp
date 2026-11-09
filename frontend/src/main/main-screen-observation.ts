import { BrowserWindow, dialog } from 'electron';
import type { IScreenObservationProvider } from '../application/ports/screen-observation.interface';
import type { ScreenObservationIdentity, ScreenObservationState } from '../shared/screen-observation-contracts';
import { parseScreenCommand, parseScreenState } from '../shared/screen-observation-validation';
import { ScreenObservationRuntime } from '../application/services/screen-observation-runtime';
import { ElectronScreenObservationCapture } from '../infrastructure/platform/screen-observation-capture';
import { randomUUID } from 'node:crypto';

export const SCREEN_SEND_DISCLOSURE = 'Вы отправите только показанный фрагмент OpenAI через личный локальный сервер. Это один платный запрос. API-данные не используются для обучения без opt-in; проверки нарушений обычно хранят их до 30 дней, дольше — по закону. отключение сохранения ответа не означает нулевое хранение: проверка безопасности может сохранить отмеченное изображение для ручной проверки. Отмена не удалит данные, уже отправленные провайдеру.';
interface Options {
  readonly provider: IScreenObservationProvider;
  readonly current: () => ScreenObservationIdentity | null;
  readonly busy: () => boolean;
  readonly now: () => number;
  readonly getWindow: () => BrowserWindow | null;
  readonly preloadPath: string;
  readonly loadSelector: (window: BrowserWindow, identity: ScreenObservationIdentity) => Promise<void>;
}
/** Owns native dialogs/selector sender and lifecycle; never passes source IDs to Renderer. */
export class MainScreenObservation {
  public readonly runtime: ScreenObservationRuntime;
  private selector: BrowserWindow | null = null;
  private readonly capture: ElectronScreenObservationCapture;
  constructor(private readonly options: Options) {
    this.capture = new ElectronScreenObservationCapture(options.now, () => this.runtime.cancel());
    this.runtime = new ScreenObservationRuntime({ capture: this.capture, provider: options.provider, current: options.current, busy: options.busy,
      now: options.now, createId: randomUUID, schedule: (delay, fn) => { const timer = setTimeout(fn, delay); return () => clearTimeout(timer); },
      select: identity => this.select(identity), closeSelector: () => this.closeSelector(),
      confirmCapture: () => this.confirm('Разовый фрагмент экрана', 'Для выбранного фрагмента приложение один раз получит весь экран в оперативную память и обрежет его. Полный кадр не отправляется. Уберите личные данные и закройте чувствительные окна.', 'Получить фрагмент'),
      confirmSend: () => this.confirm('Отправить этот фрагмент OpenAI', SCREEN_SEND_DISCLOSURE, 'Отправить показанный фрагмент'),
      hidden: async work => {
        const window = this.options.getWindow();
        if (!window || window.isDestroyed()) throw new Error('Screen unavailable');
        const visible = window.isVisible(); window.hide();
        try {
          await new Promise<void>(resolve => setTimeout(resolve, 50));
          if (window.isDestroyed() || window.isVisible() || this.selector) throw new Error('Screen unavailable');
          return await work();
        } finally { if (visible && !window.isDestroyed()) window.showInactive(); }
      },
    });
  }
  public async command(sender: object, value: unknown): Promise<ScreenObservationState> {
    const main = this.options.getWindow(), selector = this.selector;
    const isMain = !!main && !main.isDestroyed() && main.webContents === sender;
    const isSelector = !!selector && !selector.isDestroyed() && selector.webContents === sender;
    if (!isMain && !isSelector) throw new TypeError('Untrusted screen sender');
    const command = parseScreenCommand(value), current = this.options.current();
    if (!current || command.streamId !== current.streamId || command.conversationId !== current.conversationId) { this.runtime.cancel('stale'); throw new TypeError('Stale screen command'); }
    if (isSelector && command.type !== 'region' && command.type !== 'cancel') throw new TypeError('Invalid selector command');
    if (isMain && command.type === 'region') throw new TypeError('Invalid region sender');
    const result = command.type === 'start' ? await this.runtime.start(command)
      : command.type === 'region' ? await this.runtime.region(command.region)
        : command.type === 'send' ? await this.runtime.send()
          : command.type === 'cancel' ? (this.runtime.cancel(), this.runtime.read()) : this.runtime.read();
    // The selector's region invocation never receives the resulting image bytes.
    return parseScreenState(isSelector ? { phase: 'idle', error: null, preview: null, evidence: null } : result);
  }
  public dispose(): void { this.runtime.dispose(); }
  private closeSelector(): void {
    const window = this.selector; this.selector = null;
    if (window && !window.isDestroyed()) window.close();
  }
  private async select(identity: ScreenObservationIdentity): Promise<void> {
    const bounds = this.capture.selectionBounds();
    if (!bounds) throw new Error('Screen unavailable');
    const selector = new BrowserWindow({ ...bounds, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false,
      webPreferences: { preload: this.options.preloadPath, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, additionalArguments: ['--wisp-screen-selector'] } });
    this.selector = selector;
    selector.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    selector.webContents.on('will-navigate', event => event.preventDefault());
    selector.on('closed', () => { if (this.selector === selector) { this.selector = null; this.runtime.cancel('cancelled'); } });
    await this.options.loadSelector(selector, identity);
    if (this.selector === selector && !selector.isDestroyed()) selector.focus();
  }
  private async confirm(title: string, message: string, action: string): Promise<boolean> {
    const window = this.selector ?? this.options.getWindow();
    if (!window || window.isDestroyed()) return false;
    const result = await dialog.showMessageBox(window, { type: 'question', title, message, buttons: ['Отмена', action], defaultId: 0, cancelId: 0, noLink: true });
    return result.response === 1;
  }
}
