import type { MemoryHistoryReadDTO, MemoryHistoryResultDTO } from '../../shared/ipc-contracts';
import { parseMemoryHistoryRead } from '../../shared/memory-history-validation';
import type { MemoryLifecycle } from './memory-lifecycle';

export class MemoryDialogueReader {
  private stream: string | null = null;
  private epoch = 0;
  private pending = false;

  constructor(private readonly runtime: () => Pick<MemoryLifecycle, 'readDialogueHistory'> | null) {}

  replaceStream(stream: string | null): void {
    this.stream = stream;
    this.epoch++;
  }

  async read(input: MemoryHistoryReadDTO): Promise<MemoryHistoryResultDTO> {
    const command = parseMemoryHistoryRead(input);
    const runtime = this.runtime(), epoch = this.epoch;
    if (this.stream === null || command.streamId !== this.stream) return { ok: false, code: 'stale' };
    if (!runtime) return { ok: false, code: 'unavailable' };
    if (this.pending) return { ok: false, code: 'busy' };
    this.pending = true;
    try {
      const result = await runtime.readDialogueHistory().catch((): MemoryHistoryResultDTO => ({ ok: false, code: 'unavailable' }));
      return this.epoch === epoch && this.runtime() === runtime ? result : { ok: false, code: 'stale' };
    } finally {
      this.pending = false;
    }
  }
}
