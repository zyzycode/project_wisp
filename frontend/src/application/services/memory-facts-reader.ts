import type { IUserMemoryFactsReader } from '../ports/memory-knowledge.interface';
import type { MemoryFactsReadDTO, MemoryFactsResultDTO } from '../../shared/ipc-contracts';
import { parseMemoryFactsRead, parseMemoryFactsResult } from '../../shared/memory-facts-validation';

/** One unsettled read per lifetime; stream changes invalidate results without spawning more work. */
export class MemoryFactsReader {
  private stream: string | null = null;
  private epoch = 0;
  private pending = false;
  constructor(private readonly runtime: () => IUserMemoryFactsReader | null) {}
  replaceStream(stream: string | null): void { this.stream = stream; this.epoch++; }
  async read(input: MemoryFactsReadDTO): Promise<MemoryFactsResultDTO> {
    const command = parseMemoryFactsRead(input), runtime = this.runtime(), epoch = this.epoch;
    if (!runtime || this.stream === null || command.streamId !== this.stream) return { ok: false, code: 'stale' };
    if (this.pending) return { ok: false, code: 'busy' };
    this.pending = true;
    try {
      const result = await runtime.readFacts();
      if (this.epoch !== epoch || this.runtime() !== runtime) return { ok: false, code: 'stale' };
      return parseMemoryFactsResult(result.ok ? { ok: true, facts: result.value } : result);
    } catch { return { ok: false, code: 'unavailable' }; }
    finally { this.pending = false; }
  }
}
