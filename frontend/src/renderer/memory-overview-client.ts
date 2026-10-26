import { parseRoutineStatus } from '../shared/routine-status-validation';
import type { RoutineStatusDTO } from '../shared/ipc-contracts';
import type { ClearMemoryCommandDTO, MemoryFactsResultDTO, MemoryStatusDTO, WispApiBridge } from '../shared/ipc-contracts';
import { parseMemoryFactsResult } from '../shared/memory-facts-validation';
import { parseClearMemoryResult, parseMemoryStatus } from '../shared/memory-ipc-validation';
export type MemoryOverviewBridge = Pick<WispApiBridge, 'getMemoryStatus' | 'readMemoryFacts' | 'clearMemory'> & Partial<Pick<WispApiBridge, 'getRoutineStatus'>>;
type Facts = Extract<MemoryFactsResultDTO, { ok: true }>['facts'];
interface State {
  readonly status: MemoryStatusDTO | null;
  readonly routine: RoutineStatusDTO | null;
  readonly facts: Facts | null;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly uncertain: boolean;
  readonly confirming: boolean;
  readonly cleared: number;
  readonly message: string | null;
}
const IPC_WAIT_MS = 10_000;
async function boundedWait<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Memory acknowledgement timeout')), IPC_WAIT_MS); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
const empty = (): State => ({ status: null, routine: null, facts: null, loading: false, busy: false, uncertain: false, confirming: false, cleared: 0, message: null });
/** Only document-local presentation and command correlation; durable decisions stay in Main. */
export class MemoryOverviewClient {
  private streamId: string | null = null;
  private conversationId: string | null = null;
  private epoch = 0;
  private sequence = 0;
  private consumedClear = 0;
  private request = 0;
  private pending: ClearMemoryCommandDTO | null = null;
  private state = empty();
  private readonly listeners = new Set<() => void>();
  constructor(private readonly bridge: MemoryOverviewBridge, private readonly uuid: () => string = () => crypto.randomUUID()) {}
  readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  readonly getState = (): State => this.state;
  private patch(value: Partial<State>): void { this.state = { ...this.state, ...value }; for (const listener of this.listeners) listener(); }
  acceptIdentity(streamId: string | null, conversationId: string | null): void {
    if (streamId === this.streamId && conversationId === this.conversationId) return;
    this.request++;
    if (streamId !== this.streamId) {
      this.epoch++; this.sequence = 0; this.consumedClear = 0; this.pending = null; this.state = empty();
    }
    this.streamId = streamId; this.conversationId = conversationId;
    this.patch({ facts: null, status: null, routine: null, loading: false, confirming: false });
  }
  consumeClearRefresh(): boolean {
    if (this.state.cleared === this.consumedClear) return false;
    this.consumedClear = this.state.cleared; return true;
  }
  async read(preserveMessage = false): Promise<void> {
    if (!this.streamId || this.state.busy || this.pending || this.state.loading) return;
    const request = ++this.request, streamId = this.streamId;
    this.patch({ loading: true, facts: null, status: null, routine: null, ...(!preserveMessage ? { message: null } : {}) });
    try {
      const [rawStatus, rawFacts, rawRoutine] = await boundedWait(Promise.all([this.bridge.getMemoryStatus(), this.bridge.readMemoryFacts({ streamId }), this.bridge.getRoutineStatus?.()]));
      if (request !== this.request) return;
      const status = parseMemoryStatus(rawStatus), result = parseMemoryFactsResult(rawFacts);
      this.patch({ status, routine: rawRoutine === undefined ? null : parseRoutineStatus(rawRoutine) });
      if (status.mode === 'persistent' && result.ok) this.patch({ facts: result.facts });
      else if (status.mode === 'persistent') this.patch({ message: 'Не удалось загрузить факты. Обновите память и проверьте результат.' });
    } catch { if (request === this.request) this.patch({ message: 'Не удалось загрузить память. Повторите проверку.' }); }
    finally { if (request === this.request) this.patch({ loading: false }); }
  }
  openConfirmation(): void {
    if (this.state.status?.mode === 'persistent' && !this.state.loading && !this.state.busy && !this.pending) this.patch({ confirming: true, message: null });
  }
  cancelConfirmation(): void { if (!this.state.busy && !this.pending) this.patch({ confirming: false }); }
  async clear(): Promise<boolean> {
    if (!this.streamId || !this.state.confirming || this.state.busy || this.pending || this.state.status?.mode !== 'persistent') return false;
    return this.execute({ streamId: this.streamId, requestId: this.uuid(), sequence: ++this.sequence });
  }
  async retry(): Promise<boolean> { return this.pending && !this.state.busy ? this.execute(this.pending) : false; }
  private async execute(command: ClearMemoryCommandDTO): Promise<boolean> {
    const epoch = this.epoch; this.pending = command; this.request++;
    this.patch({ busy: true, loading: false, uncertain: false, confirming: false, message: 'Удаляем локальную память…' });
    let reload = false;
    try {
      const result = parseClearMemoryResult(await boundedWait(this.bridge.clearMemory(command)));
      if (epoch !== this.epoch || this.pending !== command) return false;
      if (result.requestId !== command.requestId) throw new TypeError('Uncorrelated memory receipt');
      this.pending = null;
      if (result.status !== 'cleared') {
        this.patch({ message: result.reason === 'stale' ? 'Память изменилась. Обновите её и проверьте действие.' : 'Очистка не подтверждена. Проверьте память после перезапуска.' });
        return false;
      }
      reload = true;
      this.patch({ facts: null, status: null, routine: null, cleared: this.state.cleared + 1, message: 'Локальная память очищена. Настройки, внешний вид и авторская личность сохранены.' });
      return true;
    } catch {
      if (epoch === this.epoch && this.pending === command) this.patch({ uncertain: true, message: 'Не удалось подтвердить результат. Проверьте ту же команду; новая очистка не запускается.' });
      return false;
    } finally {
      if (epoch === this.epoch) { this.patch({ busy: false }); if (reload) await this.read(true); }
    }
  }
}
const clients = new WeakMap<MemoryOverviewBridge, MemoryOverviewClient>();
export function getMemoryOverviewClient(bridge: MemoryOverviewBridge): MemoryOverviewClient {
  let client = clients.get(bridge); if (!client) { client = new MemoryOverviewClient(bridge); clients.set(bridge, client); } return client;
}
