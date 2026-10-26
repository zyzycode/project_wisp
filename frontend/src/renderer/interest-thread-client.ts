import type { InterestThreadApiBridge, InterestThreadCommandDTO, InterestThreadDTO, InterestThreadRefDTO, MemoryCardSourceDTO } from '../shared/ipc-contracts';
import { parseInterestThreadMutationResult, parseInterestThreadReadResult } from '../shared/interest-thread-validation';
type Draft = { readonly kind: 'confirm'; readonly text: string; readonly source: MemoryCardSourceDTO; readonly conversationId: string } | { readonly kind: 'close'; readonly reason: 'declined' | 'dismissed' } | { readonly kind: 'delete' };
export class InterestThreadClient {
  private stream: string | null = null;
  private sequence = 0;
  private refreshPending = false;
  private projectionEpoch = 0;
  private readSequence = 0;
  private pending: InterestThreadCommandDTO | null = null;
  private state: { item: InterestThreadDTO | null; generation: number | null; busy: boolean; uncertain: boolean; message: string | null } = { item: null, generation: null, busy: false, uncertain: false, message: null };
  private listeners = new Set<() => void>();
  constructor(private readonly bridge: InterestThreadApiBridge) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getState = () => this.state;
  acceptStream(stream: string | null): void { if (stream === this.stream) return; this.stream = stream; this.sequence = 0; this.refreshPending = false; this.pending = null; this.state = { item: null, generation: null, busy: false, uncertain: false, message: null }; this.notify(); }
  invalidateAfterReset(clearPending = false): void {
    this.projectionEpoch++; this.readSequence++; this.refreshPending = false;
    if (clearPending) this.pending = null;
    this.state = { ...this.state, item: null, generation: null, ...(this.pending ? {} : { busy: false, uncertain: false, message: null }) }; this.notify();
  }
  invalidateProjection(): void { this.projectionEpoch++; this.state = { ...this.state, item: null, generation: null, message: null }; this.notify(); }
  async read(): Promise<void> {
    if (!this.stream || this.state.uncertain) return;
    if (this.state.busy) { this.refreshPending = true; return; }
    const stream = this.stream, epoch = this.projectionEpoch, readSequence = ++this.readSequence; this.state = { ...this.state, busy: true }; this.notify();
    try {
      const result = parseInterestThreadReadResult(await this.bridge.read({ streamId: stream }));
      if (this.stream !== stream || this.projectionEpoch !== epoch) return;
      this.state = result.ok ? { ...this.state, item: result.value, generation: result.generation, message: null } : { ...this.state, item: null, generation: null, message: 'Тема временно недоступна.' };
    } catch { if (this.stream === stream && this.projectionEpoch === epoch) this.state = { ...this.state, item: null, generation: null, message: 'Не удалось прочитать тему.' }; }
    finally { if (this.stream === stream && this.readSequence === readSequence) { this.state = { ...this.state, busy: false }; this.notify(); if (this.refreshPending) { this.refreshPending = false; void this.read(); } } }
  }
  async mutate(draft: Draft): Promise<boolean> {
    if (!this.stream || this.state.generation === null || this.state.busy || this.state.uncertain) return false;
    const expected: InterestThreadRefDTO | null = this.state.item?.ref ?? null;
    const base = { streamId: this.stream, sequence: ++this.sequence, generation: this.state.generation, commandId: crypto.randomUUID() };
    const command: InterestThreadCommandDTO | null = draft.kind === 'confirm' ? { ...base, ...draft, expected, threadId: crypto.randomUUID(), confirmed: true } : expected ? { ...base, ...draft, expected } : null;
    if (!command) return false;
    this.pending = command; return this.execute(command);
  }
  async retry(): Promise<boolean> { return this.pending && !this.state.busy ? this.execute(this.pending) : false; }
  private async execute(command: InterestThreadCommandDTO): Promise<boolean> {
    this.state = { ...this.state, busy: true, uncertain: false, message: null }; this.notify();
    let ok = false;
    try {
      const result = parseInterestThreadMutationResult(await this.bridge.mutate(command));
      if (this.stream !== command.streamId || this.pending !== command) return false;
      if (result.ok && result.value.commandId !== command.commandId) throw new TypeError('Mismatched topic receipt');
      this.pending = null;
      this.state = { ...this.state, ...(result.ok ? { item: null } : {}), generation: result.generation, message: result.ok ? result.value.outcome === 'unanswered' ? 'Тема сохранена.' : result.value.outcome === 'deleted' ? 'Тема удалена.' : 'Тема закрыта.' : 'Изменение не сохранено. Обновите тему и проверьте источник.' };
      ok = result.ok;
    } catch { if (this.pending === command) this.state = { ...this.state, uncertain: true, message: 'Результат неизвестен. Повторите ту же команду.' }; }
    finally { if (this.stream === command.streamId) { this.state = { ...this.state, busy: false }; this.notify(); } }
    if (ok) { const message = this.state.message, epoch = this.projectionEpoch; await this.read(); if (this.stream !== command.streamId || this.projectionEpoch !== epoch) return false; this.state = { ...this.state, message }; this.notify(); }
    return ok;
  }
  private notify(): void { for (const listener of this.listeners) listener(); }
}
const clients = new WeakMap<InterestThreadApiBridge, InterestThreadClient>();
export function getInterestThreadClient(bridge: InterestThreadApiBridge): InterestThreadClient { let client = clients.get(bridge); if (!client) { client = new InterestThreadClient(bridge); clients.set(bridge, client); } return client; }
