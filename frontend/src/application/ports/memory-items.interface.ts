import type { MemoryOperationContext, MemoryResult } from './memory-repository.interface';

export type MemoryItemCategory = 'important_event' | 'shared_joke';
export interface MemoryItemContent {
  readonly category: MemoryItemCategory;
  readonly label: string;
  readonly text: string;
  readonly occurredOn: string | null;
}
export interface MemorySourcePair {
  readonly userMessageId: string;
  readonly assistantMessageId: string;
}
export interface MemoryItem extends MemoryItemContent {
  readonly id: string;
  readonly revision: number;
  readonly status: 'active' | 'withdrawn';
  readonly confirmedAt: string;
  readonly source: MemorySourcePair;
}
export type MemoryItemMutation =
  | { readonly kind: 'confirm'; readonly commandId: string; readonly itemId: string; readonly expectedRevision: 0; readonly confirmed: true; readonly content: MemoryItemContent; readonly source: MemorySourcePair; readonly confirmedAt: string }
  | { readonly kind: 'update'; readonly commandId: string; readonly itemId: string; readonly expectedRevision: number; readonly confirmed: true; readonly content: MemoryItemContent; readonly source: MemorySourcePair; readonly confirmedAt: string }
  | { readonly kind: 'withdraw' | 'delete'; readonly commandId: string; readonly itemId: string; readonly expectedRevision: number };
export interface MemoryItemReceipt {
  readonly commandId: string;
  readonly itemId: string;
  readonly revision: number;
  readonly outcome: 'active' | 'withdrawn' | 'deleted';
}
export interface MemoryItemPage {
  readonly items: readonly MemoryItem[];
  readonly nextCursor: number | null;
}
/** Each mutation advances the queue generation, including a rolled-back mutation. */
export interface IMemoryItemsRepository {
  confirm(command: Extract<MemoryItemMutation, { kind: 'confirm' }>, next: MemoryOperationContext): Promise<MemoryResult<MemoryItemReceipt>>;
  update(command: Extract<MemoryItemMutation, { kind: 'update' }>, next: MemoryOperationContext): Promise<MemoryResult<MemoryItemReceipt>>;
  withdraw(command: MemoryItemMutation & { readonly kind: 'withdraw' }, next: MemoryOperationContext): Promise<MemoryResult<MemoryItemReceipt>>;
  delete(command: MemoryItemMutation & { readonly kind: 'delete' }, next: MemoryOperationContext): Promise<MemoryResult<MemoryItemReceipt>>;
  list(query: { readonly cursor: number | null; readonly limit: number }, context: MemoryOperationContext): Promise<MemoryResult<MemoryItemPage>>;
}

export interface MemoryItemCandidate {
  readonly item: MemoryItem;
  readonly score: number;
  readonly labelMatches: number;
  readonly confirmationOrder: number;
}
export interface IMemoryItemRecallReader {
  /** At most8 tokens ×12 postings; exact current source validation, at most96 payloads. */
  find(tokens: readonly string[], context: MemoryOperationContext): Promise<MemoryResult<MemoryItemRecallPage>>;
}
export interface MemoryItemRecallPage {
  readonly candidates: readonly MemoryItemCandidate[];
  readonly coverage: 'complete' | 'index_building';
  readonly examined: number;
  readonly fetched: number;
}
