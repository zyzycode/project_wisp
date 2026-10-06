import type { ClearMemoryCommandDTO, ClearMemoryResultDTO } from '../../shared/ipc-contracts';
import type { MemoryResult } from '../ports/memory-repository.interface';

/** Per-stream high-water admission plus bounded receipts; reset itself is serialized. */
export class ClearMemoryUseCase {
  private streamId: string | null = null;
  private highWater = 0;
  private readonly receipts = new Map<string, Promise<ClearMemoryResultDTO>>();
  private readonly pending = new Map<string, Promise<ClearMemoryResultDTO>>();
  private serial: Promise<void> = Promise.resolve();
  constructor(private readonly reset: () => Promise<MemoryResult<void>>) {}
  replaceStream(streamId: string | null): void { this.streamId = streamId; this.highWater = 0; this.receipts.clear(); }
  execute(command: ClearMemoryCommandDTO): Promise<ClearMemoryResultDTO> {
    const failed = (reason: 'stale' | 'busy'): Promise<ClearMemoryResultDTO> => Promise.resolve({ requestId: command.requestId, status: 'failed', reason });
    if (this.streamId === null || command.streamId !== this.streamId) return failed('stale');
    const key = JSON.stringify([command.streamId, command.sequence, command.requestId]);
    const existing = this.pending.get(key) ?? this.receipts.get(key); if (existing) return existing;
    if (command.sequence <= this.highWater) return failed('stale');
    if (this.pending.size >= 100) return failed('busy');
    this.highWater = command.sequence;
    const result = this.serial.then(async (): Promise<ClearMemoryResultDTO> => {
      if (this.streamId !== command.streamId) return { requestId: command.requestId, status: 'failed', reason: 'stale' };
      let reset: MemoryResult<void>; try { reset = await this.reset(); } catch { reset = { ok: false, code: 'unavailable' }; }
      return reset.ok ? { requestId: command.requestId, status: 'cleared' } : { requestId: command.requestId, status: 'failed', reason: reset.code === 'invalid_data' || reset.code === 'conflict' ? 'io_error' : reset.code };
    });
    this.pending.set(key, result); this.serial = result.then(() => {});
    void result.then(() => {
      this.pending.delete(key);
      if (this.streamId !== command.streamId) return;
      this.receipts.set(key, result);
      if (this.receipts.size > 100) this.receipts.delete(this.receipts.keys().next().value!);
    });
    return result;
  }
}
