import type { MemoryCardCommandDTO, MemoryCardContentDTO, MemoryCardDTO, MemoryCardSourceDTO, WispApiBridge } from '../shared/ipc-contracts';
import { parseMemoryCardListResult, parseMemoryCardResult } from '../shared/memory-card-validation';

type Bridge = Pick<WispApiBridge, 'mutateMemoryCard' | 'listMemoryCards'>;
interface State {
  readonly items: readonly MemoryCardDTO[];
  readonly nextCursor: number | null;
  readonly generation: number | null;
  readonly busy: boolean;
  readonly uncertain: boolean;
  readonly message: string | null;
}
const empty = (): State => ({ items: [], nextCursor: null, generation: null, busy: false, uncertain: false, message: null });
/** Document-local sequencing and receipt correlation; persisted decisions belong to Main. */
export class MemoryCardClient {
  private streamId: string | null = null;
  private sequence = 0;
  private request = 0;
  private pending: MemoryCardCommandDTO | null = null;
  private state = empty();
  private readonly listeners = new Set<() => void>();
  public constructor(private readonly bridge: Bridge, private readonly uuid: () => string = () => crypto.randomUUID()) {}
  public readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  public readonly getState = (): State => this.state;
  private patch(update: Partial<State>): void { this.state = { ...this.state, ...update }; for (const listener of this.listeners) listener(); }
  public acceptStream(streamId: string | null): void {
    if (streamId === this.streamId) return;
    this.streamId = streamId; this.sequence = 0; this.request++; this.pending = null;
    this.state = empty(); this.patch({});
  }
  public async list(cursor: number | null = null): Promise<void> {
    if (!this.streamId || this.state.busy || this.pending) return;
    const streamId = this.streamId, request = ++this.request;
    this.patch({ busy: true });
    try {
      const result = parseMemoryCardListResult(await this.bridge.listMemoryCards({ streamId, cursor, limit: 20 }));
      if (request !== this.request || streamId !== this.streamId) return;
      if (!result.ok) { this.patch({ generation: null, message: 'Память недоступна. Повторите загрузку.' }); return; }
      this.patch({ items: result.items, nextCursor: result.nextCursor, generation: result.generation });
    } catch { if (request === this.request) this.patch({ generation: null, message: 'Не удалось загрузить память.' }); }
    finally { if (request === this.request) this.patch({ busy: false }); }
  }
  public async save(content: MemoryCardContentDTO, source: MemoryCardSourceDTO, item?: MemoryCardDTO): Promise<boolean> {
    const envelope = this.envelope(item);
    if (!envelope) return false;
    return this.execute({ ...envelope, kind: item ? 'update' : 'confirm', confirmed: true, content, source });
  }
  public async remove(kind: 'withdraw' | 'delete', item: MemoryCardDTO): Promise<boolean> {
    const envelope = this.envelope(item);
    return envelope ? this.execute({ ...envelope, kind }) : false;
  }
  private envelope(item?: MemoryCardDTO) {
    if (!this.streamId || this.state.generation === null || this.state.busy || this.pending) return null;
    return { streamId: this.streamId, sequence: ++this.sequence, commandId: this.uuid(), generation: this.state.generation,
      itemId: item?.id ?? this.uuid(), expectedRevision: item?.revision ?? 0 };
  }
  public async retry(): Promise<boolean> { return this.pending && !this.state.busy ? this.execute(this.pending) : false; }
  private async execute(command: MemoryCardCommandDTO): Promise<boolean> {
    this.pending = command; this.patch({ busy: true, uncertain: false, message: null });
    let reload = false;
    try {
      const result = parseMemoryCardResult(await this.bridge.mutateMemoryCard(command));
      if (this.pending !== command || command.streamId !== this.streamId) return false;
      if (!result.ok) {
        this.pending = null; reload = true;
        this.patch({ generation: null, message: result.code === 'stale' || result.code === 'conflict'
          ? 'Память изменилась. Проверьте актуальный список и повторите действие.' : 'Результат сохранения не подтверждён. После перезапуска проверьте список.' });
        return false;
      }
      const expected = command.kind === 'delete' ? 'deleted' : command.kind === 'withdraw' ? 'withdrawn' : 'active';
      if (result.generation !== command.generation + 1 || result.receipt.commandId !== command.commandId || result.receipt.itemId !== command.itemId
        || result.receipt.outcome !== expected || result.receipt.revision !== command.expectedRevision + 1) throw new TypeError('Uncorrelated receipt');
      this.pending = null; reload = true;
      this.patch({ message: command.kind === 'delete' ? 'Карточка удалена. Переписка сохранена.' : command.kind === 'withdraw'
        ? 'Подтверждение отозвано. Переписка сохранена.' : 'Карточка сохранена.' });
      return true;
    } catch {
      if (this.pending === command) this.patch({ uncertain: true, message: 'Подтверждение не получено. Повторите ту же команду, чтобы узнать результат.' });
      return false;
    } finally {
      if (command.streamId === this.streamId) {
        this.patch({ busy: false });
        if (reload) await this.list();
      }
    }
  }
}
const clients = new WeakMap<Bridge, MemoryCardClient>();
export function getMemoryCardClient(bridge: Bridge): MemoryCardClient {
  let client = clients.get(bridge);
  if (!client) { client = new MemoryCardClient(bridge); clients.set(bridge, client); }
  return client;
}
