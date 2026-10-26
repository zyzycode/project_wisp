import { expect, it, vi } from 'vitest';
import type { BeveragePreferenceBridge, InterestThreadApiBridge, WispApiBridge } from '../../src/shared/ipc-contracts';
import { getBeverageClient } from '../../src/renderer/beverage-client';
import { getInterestThreadClient } from '../../src/renderer/interest-thread-client';
import { getSummaryClient } from '../../src/renderer/summary-client';
import { getMemoryOperationStatus } from '../../src/renderer/memory-operation-status';
it('retains topic/beverage command identities through ordinary conversation replacement before acknowledgement', async () => {
  const topic: InterestThreadApiBridge = {
    read: vi.fn(async () => ({ ok: true, generation: 0, value: null })),
    mutate: vi.fn(async () => { throw new Error('lost'); }),
  };
  const beverage: BeveragePreferenceBridge = {
    read: vi.fn(async () => ({ ok: true, generation: 0, value: null })),
    mutate: vi.fn(async () => { throw new Error('lost'); }),
  };
  const tc = getInterestThreadClient(topic), bc = getBeverageClient(beverage);
  tc.acceptStream('s'); bc.acceptStream('s'); await tc.read(); await bc.read();
  const ts = tc.mutate({ kind: 'confirm', text: 'Тема', conversationId: 'c', source: { userMessageId: 'u', assistantMessageId: 'a' } });
  const bs = bc.mutate({ kind: 'save_hypothesis', offerId: 'offer' });
  tc.invalidateAfterReset(); bc.invalidateAfterReset(); await ts; await bs;
  expect(tc.getState().uncertain).toBe(true); expect(bc.getState().uncertain).toBe(true);
  await tc.retry(); await bc.retry();
  expect(vi.mocked(topic.mutate).mock.calls[1]![0]).toBe(vi.mocked(topic.mutate).mock.calls[0]![0]);
  expect(vi.mocked(beverage.mutate).mock.calls[1]![0]).toBe(vi.mocked(beverage.mutate).mock.calls[0]![0]);
  tc.invalidateAfterReset(true); bc.invalidateAfterReset(true);
  expect(tc.getState().uncertain).toBe(false); expect(bc.getState().uncertain).toBe(false);
  expect(await tc.retry()).toBe(false); expect(await bc.retry()).toBe(false);
});
it('aggregates topic, beverage and summary busy/unknown-result states before allowing full clear', async () => {
  const bridge: Pick<WispApiBridge, 'listMemoryCards' | 'mutateMemoryCard' | 'summary' | 'interestThread' | 'beveragePreference'> = {
    listMemoryCards: vi.fn(), mutateMemoryCard: vi.fn(),
    interestThread: { read: vi.fn(async () => ({ ok: true, generation: 0, value: null })), mutate: vi.fn(async () => { throw new Error(); }) },
    beveragePreference: { read: vi.fn(async () => ({ ok: true, generation: 0, value: null })), mutate: vi.fn(async () => { throw new Error(); }) },
    summary: { preview: vi.fn(async () => ({ ok: true, value: { previewId: 'p', expiresAt: 1000, pairs: Array.from({ length: 4 }, () => ({ userText: 'u', assistantText: 'a' })) } })), confirm: vi.fn(async () => { throw new Error(); }), deleteSummary: vi.fn() },
  };
  const status = getMemoryOperationStatus(bridge); const listener = vi.fn(); const unsubscribe = status.subscribe(listener);
  const tc = getInterestThreadClient(bridge.interestThread!), bc = getBeverageClient(bridge.beveragePreference!), sc = getSummaryClient(bridge.summary!);
  tc.acceptStream('s'); bc.acceptStream('s'); sc.acceptIdentity('s', 'c'); expect(status.getState()).toBe(false);
  const read = tc.read(); expect(status.getState()).toBe(true); await read; expect(status.getState()).toBe(false);
  await tc.mutate({ kind: 'confirm', text: 'Тема', conversationId: 'c', source: { userMessageId: 'u', assistantMessageId: 'a' } });
  expect(status.getState()).toBe(true); tc.invalidateAfterReset(true); expect(status.getState()).toBe(false);
  await bc.read(); await bc.mutate({ kind: 'save_hypothesis', offerId: 'offer' }); expect(status.getState()).toBe(true);
  bc.invalidateAfterReset(true); await sc.preview(); await sc.confirm(); expect(status.getState()).toBe(true);
  sc.acceptIdentity('s', 'next'); expect(status.getState()).toBe(false); expect(listener).toHaveBeenCalled(); unsubscribe();
});
it('consumes historical clear once so reopening chat cannot retire a newer card command', async () => {
  const { getMemoryOverviewClient } = await import('../../src/renderer/memory-overview-client');
  const { getMemoryCardClient } = await import('../../src/renderer/memory-card-client');
  const { consumeMemoryClearRefresh } = await import('../../src/renderer/memory-operation-status');
  const bridge = {
    getMemoryStatus: vi.fn(async () => ({ mode: 'persistent' as const, characterRestore: 'default' as const })),
    readMemoryFacts: vi.fn(async () => ({ ok: true as const, facts: [] })),
    clearMemory: vi.fn(async (c: { requestId: string }) => ({ requestId: c.requestId, status: 'cleared' as const })),
    listMemoryCards: vi.fn(async () => ({ ok: true as const, generation: 0, items: [], nextCursor: null })),
    mutateMemoryCard: vi.fn< WispApiBridge['mutateMemoryCard'] >(async () => { throw new Error('lost ack'); }),
  };
  const overview = getMemoryOverviewClient(bridge); overview.acceptIdentity('s', 'c'); await overview.read(); overview.openConfirmation(); await overview.clear();
  expect(consumeMemoryClearRefresh(bridge, 's', 'c')).toBe(true);
  const cards = getMemoryCardClient(bridge); cards.acceptStream('s'); await cards.list();
  const saving = cards.save({ category: 'important_event', label: 'День', text: 'Важный день', occurredOn: null }, { userMessageId: 'u', assistantMessageId: 'a' });
  cards.invalidateProjection(); // Same identity accepted when MemoryCards mounts again.
  expect(consumeMemoryClearRefresh(bridge, 's', 'c')).toBe(false);
  expect(await saving).toBe(false); expect(cards.getState().uncertain).toBe(true);
  await cards.retry(); expect(bridge.mutateMemoryCard.mock.calls[1]![0]).toBe(bridge.mutateMemoryCard.mock.calls[0]![0]);
});
