import type { MemoryCardCommandDTO, MemoryCardListCommandDTO, MemoryCardListResultDTO, MemoryCardResultDTO } from '../../shared/ipc-contracts';
import { parseMemoryCardCommand, parseMemoryCardListCommand } from '../../shared/memory-card-validation';
import type { MemoryItemMutation } from '../ports/memory-items.interface';
import type { MemoryLifecycle } from './memory-lifecycle';
import { recognizeMemoryFact } from './memory-fact-registry';

/** Trusted explicit local commands; model output never enters this use case. */
export class MemoryCards {
  private streamId: string | null = null;
  private sequence = 0;
  private readonly receipts = new Map<string, { readonly fingerprint: string; readonly result: Promise<MemoryCardResultDTO> }>();
  constructor(private readonly runtime: () => MemoryLifecycle | null, private readonly timestamp: () => string) {}
  replaceStream(streamId: string | null): void { this.streamId = streamId; this.sequence = 0; this.receipts.clear(); }
  async list(input: MemoryCardListCommandDTO): Promise<MemoryCardListResultDTO> {
    const runtime = this.runtime(), generation = runtime?.currentGeneration() ?? 0;
    let command: MemoryCardListCommandDTO;
    try { command = parseMemoryCardListCommand(input); } catch { return { ok: false, generation, code: 'invalid_data' }; }
    if (!runtime || this.streamId === null || command.streamId !== this.streamId) return { ok: false, generation, code: 'stale' };
    const result = await runtime.listItems({ cursor: command.cursor, limit: command.limit });
    if (this.streamId !== command.streamId || runtime.currentGeneration() !== generation) return { ok: false, generation: runtime.currentGeneration(), code: 'stale' };
    return result.ok ? { ok: true, generation, ...result.value } : { ok: false, generation, code: result.code };
  }
  mutate(input: MemoryCardCommandDTO): Promise<MemoryCardResultDTO> {
    const runtime = this.runtime();
    const failed = (code: 'invalid_data' | 'stale' | 'conflict' | 'busy'): Promise<MemoryCardResultDTO> => Promise.resolve({ ok: false, generation: runtime?.currentGeneration() ?? 0, code });
    let c: MemoryCardCommandDTO;
    try { c = parseMemoryCardCommand(input); } catch { return failed('invalid_data'); }
    if (!runtime || this.streamId === null || c.streamId !== this.streamId) return failed('stale');
    const fingerprint = JSON.stringify(c);
    const receipt = this.receipts.get(c.commandId);
    if (receipt) return receipt.fingerprint === fingerprint ? receipt.result : failed('conflict');
    if (c.sequence <= this.sequence || c.generation !== runtime.currentGeneration()) return failed('stale');
    if (!runtime.isRunning()) return failed('busy');
    if ((c.kind === 'confirm' || c.kind === 'update') && c.content.category === 'important_event' && recognizeMemoryFact(c.content.text)) return failed('invalid_data');
    this.sequence = c.sequence;
    const common = { commandId: c.commandId, itemId: c.itemId, expectedRevision: c.expectedRevision };
    const command: MemoryItemMutation = c.kind === 'confirm' ? { ...common, expectedRevision: 0, kind: 'confirm', content: c.content, source: c.source, confirmed: true, confirmedAt: this.timestamp() }
      : c.kind === 'update' ? { ...common, kind: 'update', content: c.content, source: c.source, confirmed: true, confirmedAt: this.timestamp() }
      : { ...common, kind: c.kind };
    const result = runtime.mutateItem(command).then((saved): MemoryCardResultDTO => {
      const generation = runtime.currentGeneration();
      if (this.streamId !== c.streamId) return { ok: false, generation, code: 'stale' };
      return saved.ok ? { ok: true, generation, receipt: saved.value } : { ok: false, generation, code: saved.code };
    });
    this.receipts.set(c.commandId, { fingerprint, result });
    if (this.receipts.size > 100) this.receipts.delete(this.receipts.keys().next().value!);
    return result;
  }
  clearReceipts(): void { this.receipts.clear(); }
}
