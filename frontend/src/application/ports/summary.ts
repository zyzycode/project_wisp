import type { MemoryOperationContext, MemoryResult, UserFact } from './memory-repository.interface';

export interface SummaryPair {
  readonly userMessageId: string; readonly assistantMessageId: string;
  readonly sessionId: string; readonly userText: string; readonly assistantText: string;
  readonly eligible: boolean;
}
export interface SummarySource { readonly userMessageId: string; readonly assistantMessageId: string; readonly sessionId: string; readonly revision: string }
export interface SummarySourceSnapshot { readonly pairs: readonly SummaryPair[]; readonly facts: readonly UserFact[] }
/** Reads include suppressed/ineligible positions so selection never joins gaps. */
export interface ISummarySourceReader {
  recent(context: MemoryOperationContext): Promise<MemoryResult<SummarySourceSnapshot>>;
  exact(sources: readonly SummarySource[], context: MemoryOperationContext): Promise<MemoryResult<SummarySourceSnapshot>>;
}
export interface SummaryReceipt { readonly commandId: string; readonly requestId: string; readonly sourceDigest: string; readonly admittedAt: number; readonly generatorVersion: 1 }
export interface SummaryEntry { readonly text: string; readonly sources: readonly SummarySource[]; readonly sourceDigest: string; readonly factsDigest: string; readonly locale: 'ru' | 'en'; readonly generatorVersion: 1 }
export interface SummaryCache { readonly formatVersion: 1; readonly entry: SummaryEntry | null; readonly receipt: SummaryReceipt | null }
export interface ISummaryCache {
  read(): Promise<MemoryResult<SummaryCache>>;
  write(value: SummaryCache, generation: number): Promise<MemoryResult<void>>;
  /** Synchronous write barrier. Existing committed cache remains until explicit write. */
  invalidate(): number;
  clear(resetReceipt: boolean, explicit?: boolean): Promise<MemoryResult<void>>;
  dispose(): void;
}
export interface ISummaryGenerator {
  generateSummary(request: { readonly requestId: string; readonly locale: 'ru' | 'en'; readonly pairs: readonly { readonly userText: string; readonly assistantText: string }[] }, signal: AbortSignal): Promise<string>;
}
export type SummaryFailure = 'unavailable' | 'busy' | 'stale' | 'rate_limited' | 'failed' | 'conflict';
export type SummaryResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: SummaryFailure };
export interface SummaryPreview { readonly previewId: string; readonly expiresAt: number; readonly pairs: readonly { readonly userText: string; readonly assistantText: string }[] }
export interface SummaryCapture { readonly text: string; readonly excludedMessageIds: readonly string[]; readonly generation: number }
/** UI uses explicit preview then confirm. Chat only captures existing valid cache. */
export interface ISummaryRuntime {
  preview(): Promise<SummaryResult<SummaryPreview>>;
  confirm(commandId: string, previewId: string): Promise<SummaryResult<string>>;
  deleteSummary(): Promise<SummaryResult<void>>;
  capture(text: string): Promise<SummaryCapture | undefined>;
  isCurrent(capture: SummaryCapture): boolean;
  interrupt(): void;
  invalidate(): void;
  reset(): Promise<SummaryResult<void>>;
  dispose(): void;
}
