import type { BeveragePreferenceBridge, BeveragePreferenceCommandDTO } from '../../shared/ipc-contracts';
import { parseBeverageCommand, parseBeverageRead } from '../../shared/beverage-validation';
import type { MemoryLifecycle } from './memory-lifecycle';
import type { IBeverageDialogue } from '../ports/memory-beverage.interface';
export class BeverageCommands implements BeveragePreferenceBridge {
  private stream: string | null = null;
  private sequence = 0;
  private readonly receipts = new Map<string, { fingerprint: string; result: ReturnType<BeveragePreferenceBridge['mutate']> }>();
  constructor(private readonly options: { readonly runtime: () => Pick<MemoryLifecycle, 'currentGeneration' | 'isRunning' | 'readBeverage' | 'mutateBeverage'> | null; readonly dialogue: () => IBeverageDialogue | null; readonly timestamp: () => string }) {}
  clearReceipts(): void { this.receipts.clear(); }
  replaceStream(stream: string | null): void { this.stream = stream; this.sequence = 0; this.receipts.clear(); this.options.dialogue()?.invalidateOffer(); }
  async read(input: { streamId: string }): ReturnType<BeveragePreferenceBridge['read']> {
    const runtime = this.options.runtime();
    let c; try { c = parseBeverageRead(input); } catch { return { ok: false, generation: runtime?.currentGeneration() ?? 0, code: 'invalid_data' }; }
    if (!runtime || c.streamId !== this.stream) return { ok: false, generation: runtime?.currentGeneration() ?? 0, code: 'stale' };
    const result = await runtime.readBeverage(), generation = runtime.currentGeneration();
    if (c.streamId !== this.stream) return { ok: false, generation, code: 'stale' };
    if (!result.ok) return { ...result, generation };
    const item = result.value;
    return { ok: true, generation, value: item ? { ref: item.ref, value: item.value, source: item.source, evidenceQuote: item.evidenceQuote, provenance: item.provenance, validity: item.validity, status: item.status, manuallyCorrected: item.manuallyCorrected } : null };
  }
  mutate(input: BeveragePreferenceCommandDTO): ReturnType<BeveragePreferenceBridge['mutate']> {
    const runtime = this.options.runtime();
    const fail = (code: 'invalid_data' | 'conflict' | 'stale' | 'busy'): ReturnType<BeveragePreferenceBridge['mutate']> => Promise.resolve({ ok: false, generation: runtime?.currentGeneration() ?? 0, code });
    let c; try { c = parseBeverageCommand(input); } catch { return fail('invalid_data'); }
    if (!runtime || c.streamId !== this.stream) return fail('stale');
    const fingerprint = JSON.stringify(c), previous = this.receipts.get(c.commandId);
    if (previous) return previous.fingerprint === fingerprint ? previous.result : fail('conflict');
    if (c.sequence <= this.sequence || c.generation !== runtime.currentGeneration()) return fail('stale');
    if (!runtime.isRunning()) return fail('busy');
    this.sequence = c.sequence;
    const offer = c.kind === 'save_hypothesis' ? this.options.dialogue()?.resolveOffer(c.offerId) : null;
    // Capture trusted opaque offer before the synchronous mutation barrier clears it.
    const run = async (): ReturnType<BeveragePreferenceBridge['mutate']> => {
      const updatedAt = this.options.timestamp();
      let command: import('../ports/memory-beverage.interface').BeverageMutation;
      if (c.kind === 'save_hypothesis') {
        if (!offer) return fail('stale');
        command = { kind: c.kind, commandId: c.commandId, updatedAt, itemId: c.itemId, expected: null, value: offer.proposal.value, source: offer.source, consented: true };
      } else if (c.kind === 'confirm' || c.kind === 'correct') {
        const read = await runtime.readBeverage();
        if (!read.ok) return { ...read, generation: runtime.currentGeneration() };
        if (this.stream !== c.streamId || runtime.currentGeneration() !== c.generation || !read.value || read.value.ref.itemId !== c.expected.itemId || read.value.ref.revision !== c.expected.revision) return fail('stale');
        command = { kind: c.kind, commandId: c.commandId, updatedAt, expected: c.expected, value: c.value, source: read.value.source, confirmed: true };
      } else command = { kind: c.kind, commandId: c.commandId, updatedAt, expected: c.expected };
      this.options.dialogue()?.invalidateOffer();
      const result = await runtime.mutateBeverage(command), generation = runtime.currentGeneration();
      return this.stream !== c.streamId ? { ok: false, generation, code: 'stale' } : result.ok ? { ok: true, generation, value: result.value } : { ...result, generation };
    };
    const result = run(); this.receipts.set(c.commandId, { fingerprint, result });
    if (this.receipts.size > 100) this.receipts.delete(this.receipts.keys().next().value!);
    return result;
  }
}
