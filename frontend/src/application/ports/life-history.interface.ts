import type { CausalLifeEpisode, CausalLifeSourceReference } from './causal-life.interface';
import type { MemoryOperationContext, MemoryResult } from './memory-repository.interface';
import type { SummaryEntry, SummaryReceipt } from './summary';

/** MEMORY-A03 targets. These declarations do not activate a reader or wire branch. */
export interface LifeHistoryWindowQuery {
  readonly fromDateUTC: string;
  readonly throughDateUTC: string;
  /** Inclusive UTC capture time; a committed same-millisecond event is eligible. */
  readonly asOf: string;
}
export interface LifeHistoryWindow {
  readonly coverage: 'complete' | 'index_building' | 'overflow' | 'clock_unknown';
  /** Empty unless the whole bounded window is valid and complete; maximum 1000. */
  readonly events: readonly CausalLifeEpisode[];
  readonly examined: number;
  readonly fetched: number;
}
export interface ILifeHistoryReader {
  readWindow(query: LifeHistoryWindowQuery, context: MemoryOperationContext): Promise<MemoryResult<LifeHistoryWindow>>;
}

/** One source revision and one shared settle wait, never a replay queue. */
export interface CausalSourceReadState {
  readonly generation: number;
  readonly revision: number;
  readonly pending: boolean;
}
export interface ICausalSourceReadBarrier {
  snapshot(): CausalSourceReadState;
  whenSettled(): Promise<void>;
}

export interface CrossDayGameObservation {
  readonly kind: 'shared_game_completions';
  readonly fromDateUTC: string;
  readonly throughDateUTC: string;
  readonly completedCount: number;
  readonly interruptedCount: number;
  readonly completedUtcDays: number;
}
export interface LifeReflectionCapture {
  readonly memoryGeneration: number;
  readonly sourceRevision: number;
  readonly asOf: string;
  readonly observation: CrossDayGameObservation;
  /** Exact distinct revision1 facts; maximum 1000, local only. */
  readonly sources: readonly CausalLifeSourceReference[];
}
export interface ILifeReflectionRuntime {
  capture(queryText: string): Promise<LifeReflectionCapture | undefined>;
  isCurrent(capture: LifeReflectionCapture): boolean;
  invalidate(): void;
  dispose(): void;
}

/** Main supplies this only for context actually dispatched, never from reply text or Renderer. */
export interface LifeDerivedContextUse {
  readonly requestId: string;
  readonly userMessageId: string;
  readonly origin: 'reflection' | 'life_summary';
}

export interface LifeSummarySource extends CausalLifeSourceReference {
  readonly contentDigest: string;
}
export interface LifeSummaryEvent {
  readonly activity: 'cursor_game';
  readonly outcome: 'completed' | 'cancelled' | 'failed';
  readonly cause: 'completed' | 'user_interrupted' | 'environment_lost' | 'timeout';
  readonly actor: 'user' | 'system' | 'autonomy' | 'unknown';
  readonly participation: 'user_engaged' | 'solitary' | 'none';
  readonly executedMs: number;
  readonly occurredAt: string;
}
export interface LifeSummaryPreview {
  readonly mode: 'life_events';
  readonly previewId: string;
  readonly expiresAt: number;
  readonly fromDateUTC: string;
  readonly throughDateUTC: string;
  readonly events: readonly LifeSummaryEvent[];
}
export interface LifeSummaryEntry {
  readonly mode: 'life_events';
  readonly text: string;
  readonly sources: readonly LifeSummarySource[];
  readonly sourceDigest: string;
  readonly fromDateUTC: string;
  readonly throughDateUTC: string;
  readonly locale: 'ru' | 'en';
  readonly generatorVersion: 2;
}
export interface LifeSummaryReceipt {
  readonly mode: 'life_events';
  readonly commandId: string;
  readonly requestId: string;
  readonly sourceDigest: string;
  readonly admittedAt: number;
  readonly generatorVersion: 2;
}
/** One cache slot and one global receipt for both modes, not two independent quotas. */
export interface SummaryCacheV2 {
  readonly formatVersion: 2;
  readonly entry: (SummaryEntry & { readonly mode: 'dialogue_pairs' }) | LifeSummaryEntry | null;
  readonly receipt: (SummaryReceipt & { readonly mode: 'dialogue_pairs' }) | LifeSummaryReceipt | null;
}
