/** Independent wire projections for ordinary reflection and explicit life-event summaries. */
export interface BackendLifeReflection {
  readonly scope: 'observed_utc_window';
  readonly validity: 'tentative';
  readonly kind: 'shared_game_completions';
  readonly fromDate: string;
  readonly throughDate: string;
  readonly completedCount: number;
  readonly interruptedCount: number;
  readonly completedDays: number;
}
export interface BackendLifeSummaryEvent {
  readonly activity: 'cursor_game' | 'book';
  readonly outcome: 'completed' | 'cancelled' | 'failed';
  readonly cause: 'completed' | 'user_interrupted' | 'environment_lost' | 'timeout';
  readonly actor: 'user' | 'system' | 'autonomy' | 'unknown';
  readonly participation: 'user_engaged' | 'solitary' | 'none';
  readonly executedMs: number;
  readonly occurredAt: string;
}
export interface BackendLifeSummaryRequest {
  readonly requestId: string;
  readonly locale: 'ru' | 'en';
  readonly stream: false;
  readonly fromDate: string;
  readonly throughDate: string;
  readonly events: readonly BackendLifeSummaryEvent[];
}
export interface BackendLifeSummaryContext {
  readonly sourceKind: 'life_events';
  readonly text: string;
  readonly fromDate: string;
  readonly throughDate: string;
  readonly eventCount: number;
}
