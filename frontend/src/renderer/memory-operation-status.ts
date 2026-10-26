import type { WispApiBridge } from '../shared/ipc-contracts';
import { getBeverageClient } from './beverage-client';
import { getInterestThreadClient } from './interest-thread-client';
import { getMemoryCardClient } from './memory-card-client';
import { getMemoryOverviewClient, type MemoryOverviewBridge } from './memory-overview-client';
import { getSummaryClient } from './summary-client';
type Bridge = Pick<WispApiBridge, 'mutateMemoryCard' | 'listMemoryCards'> & Partial<Pick<WispApiBridge, 'summary' | 'interestThread' | 'beveragePreference'>>;
const stores = new WeakMap<Bridge, ReturnType<typeof createStore>>();
function createStore(bridge: Bridge) {
  const clients = [getMemoryCardClient(bridge), ...(bridge.summary ? [getSummaryClient(bridge.summary)] : []),
    ...(bridge.interestThread ? [getInterestThreadClient(bridge.interestThread)] : []), ...(bridge.beveragePreference ? [getBeverageClient(bridge.beveragePreference)] : [])];
  return {
    subscribe(listener: () => void): () => void { const cleanups = clients.map(client => client.subscribe(listener)); return () => cleanups.forEach(cleanup => cleanup()); },
    getState: (): boolean => clients.some(client => { const state = client.getState(); return state.busy || ('uncertain' in state && state.uncertain) || ('retry' in state && state.retry); }),
  };
}
export function getMemoryOperationStatus(bridge: Bridge): ReturnType<typeof createStore> {
  let store = stores.get(bridge); if (!store) { store = createStore(bridge); stores.set(bridge, store); } return store;
}

/** Consume a confirmed reset once per document, including across chat unmount/remount. */
export function consumeMemoryClearRefresh(bridge: Bridge & MemoryOverviewBridge, streamId: string | null, conversationId: string | null): boolean {
  if (!getMemoryOverviewClient(bridge).consumeClearRefresh()) return false;
  getMemoryCardClient(bridge).invalidateProjection(true);
  if (bridge.beveragePreference) getBeverageClient(bridge.beveragePreference).invalidateAfterReset(true);
  if (bridge.interestThread) getInterestThreadClient(bridge.interestThread).invalidateAfterReset(true);
  if (bridge.summary) { const summary = getSummaryClient(bridge.summary); summary.acceptIdentity(null, null); summary.acceptIdentity(streamId, conversationId); }
  return true;
}
