import { expect, it, vi } from 'vitest';
import { parseRoutineStatus } from '../../src/shared/routine-status-validation';
import { registerMemoryIpc } from '../../src/main/memory-ipc-registration';
import { ClearMemoryUseCase } from '../../src/application/services/clear-memory.use-case';
it('requires exact readonly status with a canonical acknowledged date', () => {
  const status = { source: 'unsupported', storage: 'persistent', lastAcknowledgedAt: null };
  expect(parseRoutineStatus(status)).toEqual(status);
  for (const extra of [{ ...status, rows: [] }, { ...status, datasetEpoch: 'secret' }, { ...status, lastAcknowledgedAt: 'yesterday' }, { ...status, source: 'active' }]) expect(() => parseRoutineStatus(extra)).toThrow();
});
it('rejects foreign senders and payload arguments and removes its handler', async () => {
  const sender = {}, handlers = new Map<string, (event: { readonly sender: object }, ...args: unknown[]) => Promise<unknown>>(), remove = vi.fn();
  const dispose = registerMemoryIpc({ register: (channel, handler) => handlers.set(channel, handler), remove, getSender: () => sender,
    getStatus: () => ({ mode: 'initializing' }), clear: new ClearMemoryUseCase(async () => ({ ok: true, value: undefined })),
    routineStatus: () => ({ source: 'unknown', storage: 'initializing', lastAcknowledgedAt: null }) });
  const handler = handlers.get('wisp:get-routine-status')!;
  await expect(handler({ sender: {} })).rejects.toThrow();
  await expect(handler({ sender }, null)).rejects.toThrow();
  await expect(handler({ sender })).resolves.toEqual({ source: 'unknown', storage: 'initializing', lastAcknowledgedAt: null });
  dispose(); expect(remove).toHaveBeenCalledWith('wisp:get-routine-status');
});
