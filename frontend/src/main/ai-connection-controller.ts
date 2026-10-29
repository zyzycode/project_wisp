import type { ILocalAIBackend, IUserAIKeyStore } from '../application/ports/ai-connection.interface';
import type { AIConnectionCommandDTO, AIConnectionResultDTO, AIConnectionStatusDTO } from '../shared/ipc-contracts';

export interface PersonalAIRoute { readonly backendUrl?: string; readonly sessionToken?: string }
interface Options {
  readonly externalUrl: string | undefined;
  readonly store: IUserAIKeyStore;
  readonly backend: ILocalAIBackend;
  readonly ledgerPath: string;
  readonly createSessionToken: () => string;
  /** Must schedule relaunch/quit after the IPC response, never perform hot replacement. */
  readonly scheduleRestart: () => void;
}
export class AIConnectionController {
  private status: AIConnectionStatusDTO = { mode: 'offline', hasSavedKey: false, secureStorageAvailable: false, failure: null };
  private mutation = false;
  private disposed = false;
  private backendStopped = false;
  constructor(private readonly options: Options) {}
  async initialize(): Promise<PersonalAIRoute> {
    if (this.options.externalUrl?.trim()) {
      this.status = { ...this.status, mode: 'external' };
      return { backendUrl: this.options.externalUrl };
    }
    try {
      const available = await this.options.store.isAvailable();
      const presence = await this.options.store.hasSavedKey();
      this.status = { mode: available && presence.ok ? 'offline' : 'unavailable', hasSavedKey: presence.ok && presence.value,
        secureStorageAvailable: available, failure: !presence.ok ? presence.code : available ? null : 'secure_storage_unavailable' };
      if (!available || !presence.ok || !presence.value || this.disposed) return {};
      let loaded = await this.options.store.load();
      if (!loaded.ok) { this.status = { ...this.status, mode: 'unavailable', failure: loaded.code }; return {}; }
      if (!loaded.value || this.disposed) return {};
      const sessionToken = this.options.createSessionToken();
      const starting = this.options.backend.start({ apiKey: loaded.value, sessionToken, ledgerPath: this.options.ledgerPath });
      loaded = { ok: true, value: null };
      const started = await starting;
      if (this.disposed) return {};
      if (this.backendStopped) { this.status = { ...this.status, mode: 'unavailable', failure: 'startup_failed' }; return {}; }
      if (!started.ok) { this.status = { ...this.status, mode: 'unavailable', failure: started.code }; return {}; }
      this.status = { ...this.status, mode: 'ready', failure: null };
      return { backendUrl: `http://127.0.0.1:${started.port}`, sessionToken };
    } catch { this.status = { ...this.status, mode: 'unavailable', failure: 'startup_failed' }; return {}; }
  }
  read(): AIConnectionStatusDTO { return { ...this.status }; }
  backendUnavailable(): void {
    this.backendStopped = true;
    if (!this.disposed && this.status.mode === 'ready') this.status = { ...this.status, mode: 'unavailable', failure: 'startup_failed' };
  }
  async configure(command: AIConnectionCommandDTO): Promise<AIConnectionResultDTO> {
    if (this.disposed) return { ok: false, code: 'stale' };
    if (this.status.mode === 'external') return { ok: false, code: 'externally_managed' };
    if (this.mutation) return { ok: false, code: 'busy' };
    this.mutation = true;
    let committed = false;
    try {
      const result = await (command.kind === 'save' ? this.options.store.save(command.apiKey) : this.options.store.remove());
      if (!result.ok) return result;
      committed = true;
      this.status = { ...this.status, hasSavedKey: command.kind === 'save' };
      if (!this.disposed) this.options.scheduleRestart();
      return { ok: true, restartRequired: true };
    } catch { return { ok: false, code: 'storage_error' }; }
    finally { if (!committed) this.mutation = false; }
  }
  async stop(): Promise<void> { this.disposed = true; await this.options.backend.stop(); }
}
