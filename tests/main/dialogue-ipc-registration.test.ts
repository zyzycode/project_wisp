import { expect, it, vi } from 'vitest';
import { registerDialogueIpc } from '../../src/main/dialogue-ipc-registration';
import type { DialogueCommandReceiptDTO } from '../../src/shared/ipc-contracts';
it('checks sender before admission and cleans up its only channel', async () => {
  const sender = {}, receive = vi.fn((): DialogueCommandReceiptDTO => ({ status: 'rejected', reason: 'invalid_input' }));
  const register = vi.fn(), remove = vi.fn();
  const cleanup = registerDialogueIpc({ register, remove, getSender: () => sender, receive });
  const handler = register.mock.calls[0]![1] as (event: { sender: object }, payload: unknown) => Promise<DialogueCommandReceiptDTO>;
  await expect(handler({ sender: {} }, {})).rejects.toThrow('Untrusted'); expect(receive).not.toHaveBeenCalled();
  await expect(handler({ sender }, {})).resolves.toEqual({ status: 'rejected', reason: 'invalid_input' });
  cleanup(); expect(remove).toHaveBeenCalledExactlyOnceWith('wisp:dialogue-command');
});
