import type { BeveragePreferenceBridge, BeveragePreferenceCommandDTO, BeveragePreferenceDTO, BeveragePreferenceRefDTO } from '../shared/ipc-contracts';
import { parseBeverageMutationResult, parseBeverageReadResult } from '../shared/beverage-validation';
type Draft = { readonly kind: 'save_hypothesis'; readonly offerId: string } | { readonly kind: 'confirm' | 'correct'; readonly value: 'coffee' | 'tea' } | { readonly kind: 'reject' | 'withdraw' | 'delete' };
export class BeverageClient {
  private stream: string | null = null;
  private sequence = 0;
  private refreshPending = false;
  private projectionEpoch = 0;
  private pending: BeveragePreferenceCommandDTO | null = null;
  private state: { item: BeveragePreferenceDTO | null; generation: number | null; busy: boolean; uncertain: boolean; message: string | null } = { item: null, generation: null, busy: false, uncertain: false, message: null };
  private listeners = new Set<() => void>();
  constructor(private readonly bridge: BeveragePreferenceBridge) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getState = () => this.state;
  acceptStream(stream: string | null): void { if (stream === this.stream) return; this.stream = stream; this.sequence = 0; this.refreshPending = false; this.pending = null; this.state = { item: null, generation: null, busy: false, uncertain: false, message: null }; this.notify(); }
  invalidateProjection(): void { this.projectionEpoch++; this.state = { ...this.state, item: null, generation: null, message: null }; this.notify(); }
  async read(): Promise<void> {
    if (!this.stream || this.state.uncertain) return;
    if (this.state.busy) { this.refreshPending = true; return; }
    const stream = this.stream, epoch = this.projectionEpoch; this.state = { ...this.state, busy: true }; this.notify();
    try {
      const result = parseBeverageReadResult(await this.bridge.read({ streamId: stream }));
      if (this.stream !== stream || this.projectionEpoch !== epoch) return;
      this.state = result.ok ? { ...this.state, item: result.value, generation: result.generation, message: null } : { ...this.state, item: null, generation: null, message: 'Предпочтение временно недоступно.' };
    } catch { if (this.stream === stream && this.projectionEpoch === epoch) this.state = { ...this.state, item: null, generation: null, message: 'Не удалось прочитать предпочтение.' }; }
    finally { if (this.stream === stream) { this.state = { ...this.state, busy: false }; this.notify(); if (this.refreshPending) { this.refreshPending = false; void this.read(); } } }
  }
  async mutate(draft: Draft): Promise<boolean> {
    if (!this.stream || this.state.generation === null || this.state.busy || this.state.uncertain) return false;
    const expected: BeveragePreferenceRefDTO | null = this.state.item?.ref ?? null;
    const base = { streamId: this.stream, sequence: ++this.sequence, generation: this.state.generation, commandId: crypto.randomUUID() };
    const command: BeveragePreferenceCommandDTO | null = draft.kind === 'save_hypothesis' ? expected ? null : { ...base, ...draft, expected: null, itemId: crypto.randomUUID(), consented: true } : !expected ? null : draft.kind === 'confirm' || draft.kind === 'correct' ? { ...base, ...draft, expected, confirmed: true } : { ...base, kind: draft.kind as 'reject' | 'withdraw' | 'delete', expected };
    if (!command) return false;
    this.pending = command; return this.execute(command);
  }
  async retry(): Promise<boolean> { return this.pending && !this.state.busy ? this.execute(this.pending) : false; }
  private async execute(command: BeveragePreferenceCommandDTO): Promise<boolean> {
    this.state = { ...this.state, busy: true, uncertain: false, message: null }; this.notify();
    let ok = false;
    try {
      const result = parseBeverageMutationResult(await this.bridge.mutate(command));
      if (this.stream !== command.streamId || this.pending !== command) return false;
      if (result.ok && result.value.commandId !== command.commandId) throw new TypeError('Mismatched preference receipt');
      this.pending = null;
      this.state = { ...this.state, ...(result.ok ? { item: null } : {}), generation: result.generation, message: result.ok ? result.value.outcome === 'hypothesis' ? 'Предположение сохранено.' : result.value.outcome === 'deleted' ? 'Предпочтение удалено.' : 'Предпочтение изменено.' : 'Изменение не сохранено. Обновите предпочтение и проверьте источник.' };
      ok = result.ok;
    } catch { if (this.pending === command) this.state = { ...this.state, uncertain: true, message: 'Результат неизвестен. Повторите ту же команду.' }; }
    finally { if (this.stream === command.streamId) { this.state = { ...this.state, busy: false }; this.notify(); } }
    if (ok) { const message = this.state.message, epoch = this.projectionEpoch; await this.read(); if (this.stream !== command.streamId || this.projectionEpoch !== epoch) return false; this.state = { ...this.state, message }; this.notify(); }
    return ok;
  }
  private notify(): void { for (const listener of this.listeners) listener(); }
}
const clients = new WeakMap<BeveragePreferenceBridge, BeverageClient>();
export function getBeverageClient(bridge: BeveragePreferenceBridge): BeverageClient { let client = clients.get(bridge); if (!client) { client = new BeverageClient(bridge); clients.set(bridge, client); } return client; }
