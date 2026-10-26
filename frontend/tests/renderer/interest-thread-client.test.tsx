import { expect, it, vi } from 'vitest';
import { InterestThreadClient } from '../../src/renderer/interest-thread-client';
import type { InterestThreadApiBridge } from '../../src/shared/ipc-contracts';
it('preserves exact command on unknown acknowledgement and rejects foreign receipts', async () => {
  const read = vi.fn<InterestThreadApiBridge['read']>(async () => ({ ok: true, generation: 0, value: null }));
  const mutate = vi.fn<InterestThreadApiBridge['mutate']>(async c => ({ ok: true, generation: 1, value: { commandId: c.commandId, ref: { threadId: c.kind === 'confirm' ? c.threadId : c.expected.threadId, revision: 1 }, outcome: 'unanswered' } }));
  const client = new InterestThreadClient({ read, mutate }); client.acceptStream('s'); await client.read();
  mutate.mockResolvedValueOnce({ ok: true, generation: 1, value: { commandId: 'foreign', ref: { threadId: 't', revision: 1 }, outcome: 'unanswered' } });
  expect(await client.mutate({ kind: 'confirm', text: 'topic', source: { userMessageId: 'u', assistantMessageId: 'a' }, conversationId: 'c' })).toBe(false);
  expect(client.getState()).toMatchObject({ uncertain: true }); expect(await client.retry()).toBe(true); expect(mutate.mock.calls[1]![0]).toEqual(mutate.mock.calls[0]![0]);
});
it('coalesces a refresh requested at committed admission release while an earlier read is busy', async () => {
  let settle!: (value: Awaited<ReturnType<InterestThreadApiBridge['read']>>) => void;
  const item = { ref: { threadId: 't', revision: 1 }, state: 'unanswered' as const, text: 'quote', confirmedAt: '2026-10-20T00:00:00.000Z', expiresAt: '2026-10-27T00:00:00.000Z', attempted: true };
  const read = vi.fn<InterestThreadApiBridge['read']>().mockImplementationOnce(() => new Promise(resolve => { settle = resolve; })).mockResolvedValue({ ok: true, generation: 1, value: { ...item, ref: { ...item.ref, revision: 2 }, state: 'closed', text: null } });
  const client = new InterestThreadClient({ read, mutate: vi.fn() }); client.acceptStream('s'); const first = client.read();
  await client.read(); await client.read(); expect(read).toHaveBeenCalledTimes(1);
  settle({ ok: true, generation: 0, value: item }); await first; for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(2); expect(client.getState()).toMatchObject({ item: { state: 'closed', text: null }, busy: false });
});
it('clears retired payload after committed close/delete/replace even when the following read fails', async () => {
  const item = { ref: { threadId: 't', revision: 1 }, state: 'unanswered' as const, text: 'old quote', confirmedAt: '2026-10-20T00:00:00.000Z', expiresAt: '2026-10-27T00:00:00.000Z', attempted: true };
  const read = vi.fn<InterestThreadApiBridge['read']>().mockResolvedValueOnce({ ok: true, generation: 0, value: item }).mockResolvedValue({ ok: false, generation: 1, code: 'unavailable' });
  const mutate = vi.fn<InterestThreadApiBridge['mutate']>(async c => ({ ok: true, generation: 1, value: { commandId: c.commandId, ref: item.ref, outcome: 'closed' } }));
  const client = new InterestThreadClient({ read, mutate }); client.acceptStream('s'); await client.read(); expect(await client.mutate({ kind: 'close', reason: 'declined' })).toBe(true); expect(client.getState().item).toBeNull();
});
it('late post-mutation refresh cannot publish a retired-stream success notice', async () => {
  let settle!: (value: Awaited<ReturnType<InterestThreadApiBridge['read']>>) => void;
  const read = vi.fn<InterestThreadApiBridge['read']>().mockResolvedValueOnce({ ok: true, generation: 0, value: null }).mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  const mutate = vi.fn<InterestThreadApiBridge['mutate']>(async c => ({ ok: true, generation: 1, value: { commandId: c.commandId, ref: { threadId: 't', revision: 1 }, outcome: 'unanswered' } }));
  const client = new InterestThreadClient({ read, mutate }); client.acceptStream('old'); await client.read();
  const saving = client.mutate({ kind: 'confirm', text: 'quote', conversationId: 'c', source: { userMessageId: 'u', assistantMessageId: 'a' } });
  for (let i = 0; i < 20; i++) await Promise.resolve(); expect(read).toHaveBeenCalledTimes(2);
  client.acceptStream('new'); settle({ ok: true, generation: 1, value: null }); expect(await saving).toBe(false); expect(client.getState()).toMatchObject({ item: null, message: null, generation: null, busy: false });
});
it('external conversation barrier clears projection and rejects old in-flight read even when fresh read fails', async () => {
  let settle!: (value: Awaited<ReturnType<InterestThreadApiBridge['read']>>) => void;
  const item = { ref: { threadId: 't', revision: 1 }, state: 'unanswered' as const, text: 'old quote', confirmedAt: '2026-10-20T00:00:00.000Z', expiresAt: '2026-10-27T00:00:00.000Z', attempted: true };
  const read = vi.fn<InterestThreadApiBridge['read']>().mockResolvedValueOnce({ ok: true, generation: 0, value: item }).mockImplementationOnce(() => new Promise(resolve => { settle = resolve; })).mockResolvedValue({ ok: false, generation: 1, code: 'unavailable' });
  const client = new InterestThreadClient({ read, mutate: vi.fn() }); client.acceptStream('s'); await client.read(); const oldRead = client.read();
  client.invalidateProjection(); await client.read(); expect(client.getState().item).toBeNull();
  settle({ ok: true, generation: 0, value: item }); await oldRead; for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(3); expect(client.getState()).toMatchObject({ item: null, generation: null, busy: false });
});

it('failed post-answer refresh never retains the previously unanswered quote and reply controls', async () => {
  const item = { ref: { threadId: 't', revision: 1 }, state: 'unanswered' as const, text: 'retired quote', confirmedAt: '2026-10-20T00:00:00.000Z', expiresAt: '2026-10-27T00:00:00.000Z', attempted: true };
  const read = vi.fn<InterestThreadApiBridge['read']>().mockResolvedValueOnce({ ok: true, generation: 0, value: item }).mockRejectedValueOnce(new Error('unavailable'));
  const client = new InterestThreadClient({ read, mutate: vi.fn() }); client.acceptStream('s'); await client.read(); expect(client.getState().item?.text).toBe('retired quote');
  await client.read(); expect(client.getState()).toMatchObject({ item: null, generation: null });
});
