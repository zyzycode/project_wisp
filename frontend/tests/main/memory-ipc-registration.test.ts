import { expect, it, vi } from 'vitest';
import { registerMemoryIpc } from '../../src/main/memory-ipc-registration';
import { ClearMemoryUseCase } from '../../src/application/services/clear-memory.use-case';
function fixture() {
  const handlers = new Map<string, (event: { sender: object }, ...args: unknown[]) => Promise<unknown>>(); const sender = {};
  const reset = vi.fn(async () => ({ ok: true, value: undefined } as const)); const clear = new ClearMemoryUseCase(reset); clear.replaceStream('stream');
  const remove = vi.fn(); const unregister = registerMemoryIpc({ register: (channel, handler) => handlers.set(channel, handler), remove, getSender: () => sender, getStatus: () => ({ mode: 'persistent', characterRestore: 'restored' }), clear });
  return { handlers, sender, reset, remove, unregister };
}
it('checks sender and exact shape before invoking reset', async () => {
  const f = fixture(), clear = f.handlers.get('wisp:clear-memory')!, c = { streamId: 'stream', requestId: 'request', sequence: 1 };
  await expect(clear({ sender: {} }, c)).rejects.toThrow('Untrusted');
  await expect(clear({ sender: f.sender }, { ...c, extra: true })).rejects.toThrow();
  await expect(clear({ sender: f.sender }, { ...c, sequence: 0 })).rejects.toThrow();
  expect(f.reset).not.toHaveBeenCalled(); expect(await clear({ sender: f.sender }, c)).toEqual({ requestId: 'request', status: 'cleared' });
});
it('accepts no arguments for status and releases both handlers', async () => {
  const f = fixture(), status = f.handlers.get('wisp:get-memory-status')!;
  await expect(status({ sender: f.sender }, undefined)).rejects.toThrow();
  expect(await status({ sender: f.sender })).toEqual({ mode: 'persistent', characterRestore: 'restored' });
  f.unregister(); expect(f.remove.mock.calls).toEqual([['wisp:get-memory-status'], ['wisp:clear-memory']]);
});
