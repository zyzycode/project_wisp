import type { InterestThreadApiBridge, InterestThreadCommandDTO, InterestThreadDTO } from '../../shared/ipc-contracts';
import { parseInterestThreadCommand, parseInterestThreadRead } from '../../shared/interest-thread-validation';
import type { MemoryLifecycle } from './memory-lifecycle';
import { isInterestThreadSourceText } from './memory-fact-registry';

export class InterestThreadCommands implements InterestThreadApiBridge {
  private stream: string | null = null;
  private sequence = 0;
  private readonly receipts = new Map<string, { fingerprint: string; result: ReturnType<InterestThreadApiBridge['mutate']> }>();
  constructor(private readonly options: {
    readonly runtime: () => (Pick<MemoryLifecycle, 'currentGeneration' | 'isRunning' | 'readInterestThread' | 'mutateInterestThread'> & { readonly history: Pick<MemoryLifecycle['history'], 'whenSettled'> }) | null;
    readonly sourceText: (command: Extract<InterestThreadCommandDTO, { kind: 'confirm' }>) => string | null;
    readonly timestamp: () => string;
    readonly createId: () => string;
    readonly bounded: <T>(work: Promise<T>) => Promise<T | undefined>;
  }) {}
  replaceStream(stream: string | null): void { this.stream = stream; this.sequence = 0; this.receipts.clear(); }
  async read(input: { streamId: string }): ReturnType<InterestThreadApiBridge['read']> {
    const runtime = this.options.runtime(); let command;
    try { command = parseInterestThreadRead(input); } catch { return { ok: false, generation: runtime?.currentGeneration() ?? 0, code: 'invalid_data' }; }
    if (!runtime || command.streamId !== this.stream) return { ok: false, generation: runtime?.currentGeneration() ?? 0, code: 'stale' };
    let read = await runtime.readInterestThread();
    if (command.streamId !== this.stream) return { ok: false, generation: runtime.currentGeneration(), code: 'stale' };
    if (!read.ok) return { ...read, generation: runtime.currentGeneration() };
    const t = read.value.thread;
    if (t?.state === 'unanswered' && (!read.value.sourceValid || Date.parse(this.options.timestamp()) >= Date.parse(t.expiresAt))) {
      const closed = await runtime.mutateInterestThread({ kind: 'close', commandId: this.options.createId(), expected: t.ref, reason: read.value.sourceValid ? 'expired' : 'source_changed' });
      if (!closed.ok) return { ...closed, generation: runtime.currentGeneration() };
      read = await runtime.readInterestThread();
    }
    const generation = runtime.currentGeneration();
    if (command.streamId !== this.stream) return { ok: false, generation, code: 'stale' };
    if (!read.ok) return { ...read, generation };
    const thread = read.value.thread;
    const value: InterestThreadDTO | null = thread ? { ref: thread.ref, state: thread.state, text: thread.text, confirmedAt: thread.confirmedAt, expiresAt: thread.expiresAt, attempted: thread.attempt !== null } : null;
    return { ok: true, generation, value };
  }
  mutate(input: InterestThreadCommandDTO): ReturnType<InterestThreadApiBridge['mutate']> {
    const runtime = this.options.runtime();
    const fail = (code: 'invalid_data' | 'conflict' | 'stale' | 'busy'): ReturnType<InterestThreadApiBridge['mutate']> => Promise.resolve({ ok: false, generation: runtime?.currentGeneration() ?? 0, code });
    let c: InterestThreadCommandDTO;
    try { c = parseInterestThreadCommand(input); } catch { return fail('invalid_data'); }
    if (!runtime || c.streamId !== this.stream) return fail('stale');
    const fingerprint = JSON.stringify(c), previous = this.receipts.get(c.commandId);
    if (previous) return previous.fingerprint === fingerprint ? previous.result : fail('conflict');
    if (c.sequence <= this.sequence || c.generation !== runtime.currentGeneration()) return fail('stale');
    if (!runtime.isRunning()) return fail('busy');
    this.sequence = c.sequence;
    const run = async (): ReturnType<InterestThreadApiBridge['mutate']> => {
      if (c.kind === 'confirm') {
        const settled = await this.options.bounded(runtime.history.whenSettled().then(() => true));
        if (!settled) return { ok: false, generation: runtime.currentGeneration(), code: 'busy' };
        if (this.stream !== c.streamId || runtime.currentGeneration() !== c.generation) return fail('stale');
        const text = this.options.sourceText(c);
        if (!text || !text.includes(c.text) || !isInterestThreadSourceText(text)) return fail('invalid_data');
      }
      const saved = c.kind === 'confirm' ? await runtime.mutateInterestThread({ commandId: c.commandId, expected: c.expected, kind: 'confirm', threadId: c.threadId, confirmed: true, source: c.source, text: c.text, confirmedAt: this.options.timestamp() }) : c.kind === 'close' ? await runtime.mutateInterestThread({ kind: 'close', commandId: c.commandId, expected: c.expected, reason: c.reason }) : await runtime.mutateInterestThread({ kind: 'delete', commandId: c.commandId, expected: c.expected });
      const generation = runtime.currentGeneration();
      if (this.stream !== c.streamId) return { ok: false, generation, code: 'stale' };
      return saved.ok ? { ok: true, generation, value: saved.value } : { ...saved, generation };
    };
    const result = run(); this.receipts.set(c.commandId, { fingerprint, result });
    if (this.receipts.size > 100) this.receipts.delete(this.receipts.keys().next().value!);
    return result;
  }
}
