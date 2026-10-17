import type { SummaryApiBridge, SummaryConfirmCommandDTO, SummaryFailureDTO, SummaryPreviewDTO } from '../shared/ipc-contracts';
import { parseSummaryDeleteResult, parseSummaryPreviewResult, parseSummaryTextResult } from '../shared/summary-ipc-validation';
interface State { readonly preview: SummaryPreviewDTO | null; readonly busy: boolean; readonly message: string | null; readonly text: string | null; readonly retry: boolean }
const empty = (): State => ({ preview: null, busy: false, message: null, text: null, retry: false });
const messages: Record<SummaryFailureDTO, string> = {
  unavailable: 'Краткое содержание недоступно: нужны включённый сервис, локальная память и не менее четырёх подходящих пар.',
  busy: 'Сервис занят. Повторите действие позже.', stale: 'Источники изменились или просмотр истёк. Откройте новый просмотр.',
  rate_limited: 'Попытка уже использована за последние 24 часа.', failed: 'Не удалось составить или сохранить краткое содержание.', conflict: 'Команда больше не соответствует просмотру. Откройте новый просмотр.',
};
/** Document-local presentation; source selection, consent admission and cache stay in Main. */
export class SummaryClient {
  private streamId: string | null = null;
  private identity: string | null = null;
  private epoch = 0;
  private pending: SummaryConfirmCommandDTO | null = null;
  private state = empty();
  private readonly listeners = new Set<() => void>();
  constructor(private readonly bridge: SummaryApiBridge, private readonly uuid: () => string = () => crypto.randomUUID()) {}
  readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  readonly getState = (): State => this.state;
  private patch(value: Partial<State>): void { this.state = { ...this.state, ...value }; for (const listener of this.listeners) listener(); }
  acceptIdentity(streamId: string | null, conversationId: string | null): void {
    const identity = streamId && conversationId ? `${streamId}:${conversationId}` : null;
    if (identity === this.identity) return;
    this.identity = identity; this.streamId = streamId; this.epoch++; this.pending = null; this.state = empty(); this.patch({});
  }
  cancelPreview(): void { if (!this.state.busy) { this.pending = null; this.patch({ preview: null, retry: false }); } }
  async preview(): Promise<void> {
    if (!this.streamId || this.state.busy) return;
    const epoch = this.epoch; this.pending = null; this.patch({ busy: true, preview: null, retry: false, message: null });
    try {
      const result = parseSummaryPreviewResult(await this.bridge.preview({ streamId: this.streamId }));
      if (epoch !== this.epoch) return;
      this.patch(result.ok ? { preview: result.value } : { message: messages[result.code] });
    } catch { if (epoch === this.epoch) this.patch({ message: 'Не удалось открыть просмотр.' }); }
    finally { if (epoch === this.epoch) this.patch({ busy: false }); }
  }
  async confirm(): Promise<void> {
    if (!this.streamId || !this.state.preview || this.state.busy) return;
    const command = this.pending ?? { streamId: this.streamId, previewId: this.state.preview.previewId, commandId: this.uuid() };
    this.pending = command; const epoch = this.epoch; this.patch({ busy: true, retry: false, message: 'Составляем краткое содержание…' });
    try {
      const result = parseSummaryTextResult(await this.bridge.confirm(command));
      if (epoch !== this.epoch) return;
      this.pending = null;
      this.patch(result.ok ? { text: result.value, preview: null, message: 'Краткое содержание сохранено локально. Это неподтверждённый пересказ.' } : { preview: null, message: messages[result.code] });
    } catch { if (epoch === this.epoch) this.patch({ retry: true, message: 'Результат команды неизвестен. Можно проверить ту же команду без новой генерации.' }); }
    finally { if (epoch === this.epoch) this.patch({ busy: false }); }
  }
  async deleteSummary(): Promise<void> {
    if (!this.streamId || this.state.busy) return;
    const epoch = this.epoch; this.patch({ busy: true });
    try {
      const result = parseSummaryDeleteResult(await this.bridge.deleteSummary({ streamId: this.streamId }));
      if (epoch !== this.epoch) return;
      if (result.ok) { this.pending = null; this.patch({ preview: null, text: null, retry: false, message: 'Краткое содержание удалено. Переписка и ограничение 24 часа сохранены.' }); }
      else this.patch({ message: messages[result.code] });
    } catch { if (epoch === this.epoch) this.patch({ message: 'Не удалось подтвердить удаление.' }); }
    finally { if (epoch === this.epoch) this.patch({ busy: false }); }
  }
}
const clients = new WeakMap<SummaryApiBridge, SummaryClient>();
export function getSummaryClient(bridge: SummaryApiBridge): SummaryClient { let client = clients.get(bridge); if (!client) { client = new SummaryClient(bridge); clients.set(bridge, client); } return client; }
