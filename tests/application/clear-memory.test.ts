import { expect, it, vi } from 'vitest';
import { ClearMemoryUseCase } from '../../src/application/services/clear-memory.use-case';
import type { MemoryResult } from '../../src/application/ports/memory-repository.interface';
it('joins identical in-flight retries and never repeats deletion after receipt eviction', async () => {
  let resolve!: (result: MemoryResult<void>) => void;
  const reset = vi.fn<() => Promise<MemoryResult<void>>>(() => new Promise(yes => { resolve = yes; }));
  const useCase = new ClearMemoryUseCase(reset); useCase.replaceStream('s'); const command = { streamId: 's', requestId: 'r1', sequence: 1 };
  const first = useCase.execute(command); expect(useCase.execute(command)).toBe(first); await Promise.resolve(); expect(reset).toHaveBeenCalledTimes(1);
  resolve({ ok: true, value: undefined }); expect(await first).toEqual({ requestId: 'r1', status: 'cleared' }); expect(await useCase.execute(command)).toEqual({ requestId: 'r1', status: 'cleared' });
  reset.mockResolvedValue({ ok: true, value: undefined });
  for (let sequence = 2; sequence < 103; sequence++) await useCase.execute({ streamId: 's', requestId: `r${sequence}`, sequence });
  expect(await useCase.execute(command)).toEqual({ requestId: 'r1', status: 'failed', reason: 'stale' }); expect(reset).toHaveBeenCalledTimes(102);
});
it('serializes resets and invalidates queued commands from a replaced Brain stream', async () => {
  let resolve!: (result: MemoryResult<void>) => void;
  const reset = vi.fn<() => Promise<MemoryResult<void>>>(() => new Promise(yes => { resolve = yes; }));
  const useCase = new ClearMemoryUseCase(reset); useCase.replaceStream('s');
  const first = useCase.execute({ streamId: 's', requestId: 'a', sequence: 1 }); const next = useCase.execute({ streamId: 's', requestId: 'b', sequence: 2 }); await Promise.resolve();
  expect(reset).toHaveBeenCalledTimes(1); useCase.replaceStream('new'); resolve({ ok: false, code: 'conflict' });
  expect(await first).toEqual({ requestId: 'a', status: 'failed', reason: 'io_error' }); expect(await next).toEqual({ requestId: 'b', status: 'failed', reason: 'stale' });
});
