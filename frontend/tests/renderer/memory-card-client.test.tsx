import { expect, it, vi } from 'vitest';
import { MemoryCardClient } from '../../src/renderer/memory-card-client';
import type { MemoryCardCommandDTO, MemoryCardListResultDTO, MemoryCardResultDTO } from '../../src/shared/ipc-contracts';
const content = { category: 'important_event', label: 'День', text: 'Важный день', occurredOn: '2026-10-17' } as const;
const source = { userMessageId: 'user', assistantMessageId: 'assistant' };
function fixture() {
  const listMemoryCards = vi.fn(async (): Promise<MemoryCardListResultDTO> => ({ ok: true, generation: 2, items: [], nextCursor: null }));
  const mutateMemoryCard = vi.fn(async (c: MemoryCardCommandDTO): Promise<MemoryCardResultDTO> => ({ ok: true, generation: c.generation + 1,
    receipt: { commandId: c.commandId, itemId: c.itemId, revision: c.expectedRevision + 1, outcome: c.kind === 'delete' ? 'deleted' : c.kind === 'withdraw' ? 'withdrawn' : 'active' } }));
  let id = 0; const client = new MemoryCardClient({ listMemoryCards, mutateMemoryCard }, () => `id-${++id}`);
  client.acceptStream('stream'); return { client, listMemoryCards, mutateMemoryCard };
}
it('requires loaded generation and sends an explicit confirmation with ordered commands', async () => {
  const f = fixture(); expect(await f.client.save(content, source)).toBe(false);
  await f.client.list(); expect(await f.client.save(content, source)).toBe(true);
  expect(f.mutateMemoryCard.mock.calls[0]?.[0]).toMatchObject({ kind: 'confirm', confirmed: true, generation: 2, sequence: 1, expectedRevision: 0, content, source });
  expect(f.client.getState().message).toBe('Карточка сохранена.');
  await f.client.save(content, source); expect(f.mutateMemoryCard.mock.calls[1]?.[0].sequence).toBe(2);
  await f.client.list(20); expect(f.listMemoryCards).toHaveBeenLastCalledWith({ streamId: 'stream', cursor: 20, limit: 20 });
});
it('does not claim success for unknown acknowledgement and replays exact command ids', async () => {
  const f = fixture(); await f.client.list();
  f.mutateMemoryCard.mockRejectedValueOnce(new Error('private'));
  expect(await f.client.save(content, source)).toBe(false); expect(f.client.getState().uncertain).toBe(true);
  expect(f.client.getState().message).not.toContain('private');
  expect(await f.client.save(content, source)).toBe(false);
  expect(await f.client.retry()).toBe(true); expect(f.mutateMemoryCard.mock.calls[1]?.[0]).toBe(f.mutateMemoryCard.mock.calls[0]?.[0]);
});
it('rejects validly shaped but unrelated receipts', async () => {
  const f = fixture(); await f.client.list();
  f.mutateMemoryCard.mockResolvedValueOnce({ ok: true, generation: 2, receipt: { commandId: 'other', itemId: 'other', revision: 1, outcome: 'active' } });
  expect(await f.client.save(content, source)).toBe(false); expect(f.client.getState().uncertain).toBe(true);
});
it('ignores late mutation and list results after stream replacement', async () => {
  const f = fixture(); await f.client.list();
  let settle!: (r: MemoryCardResultDTO) => void;
  f.mutateMemoryCard.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  const saving = f.client.save(content, source); f.client.acceptStream('next');
  const c = f.mutateMemoryCard.mock.calls[0]![0];
  settle({ ok: true, generation: 2, receipt: { commandId: c.commandId, itemId: c.itemId, revision: 1, outcome: 'active' } });
  expect(await saving).toBe(false); expect(f.client.getState().message).toBeNull();
  let page!: (r: MemoryCardListResultDTO) => void;
  f.listMemoryCards.mockImplementationOnce(() => new Promise(resolve => { page = resolve; }));
  const loading = f.client.list(); f.client.acceptStream('third'); page({ ok: true, generation: 99, items: [], nextCursor: 20 });
  await loading; expect(f.client.getState().generation).toBeNull();
});
it('reloads stale generation without reporting a save and preserves transcript wording for removal', async () => {
  const f = fixture(); await f.client.list();
  f.mutateMemoryCard.mockResolvedValueOnce({ ok: false, generation: 3, code: 'stale' });
  expect(await f.client.save(content, source)).toBe(false); expect(f.client.getState().message).toContain('Память изменилась');
  const item = { ...content, source, id: 'item', revision: 2, status: 'active', confirmedAt: '2026-10-17T00:00:00.000Z' } as const;
  expect(await f.client.remove('withdraw', item)).toBe(true); expect(f.client.getState().message).toContain('Переписка сохранена');
  expect(await f.client.remove('delete', { ...item, revision: 3 })).toBe(true); expect(f.client.getState().message).toContain('Переписка сохранена');
});
it('preserves pending identity across a same-stream conversation barrier and keeps command sequencing', async () => {
  const f = fixture(); await f.client.list();
  let reject!: (error: Error) => void;
  f.mutateMemoryCard.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const saving = f.client.save(content, source); f.client.invalidateProjection();
  reject(new Error('lost ack')); expect(await saving).toBe(false); expect(f.client.getState().uncertain).toBe(true);
  expect(await f.client.retry()).toBe(true); expect(f.mutateMemoryCard.mock.calls[1]![0]).toBe(f.mutateMemoryCard.mock.calls[0]![0]);
  f.client.invalidateProjection(true); await f.client.list(); await f.client.save(content, source);
  expect(f.mutateMemoryCard.mock.calls[2]![0].sequence).toBe(2);
});
