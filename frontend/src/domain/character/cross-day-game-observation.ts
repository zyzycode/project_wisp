interface ObservedGame {
  readonly occurredAt: string;
  readonly activity: 'cursor_game' | null;
  readonly cause: string;
  readonly participation: string;
  readonly executedMs: number;
  readonly source: string;
  readonly triggerSequence: number | null;
}
/** Input is a complete, validated UTC window in canonical occurrence order. */
export function crossDayGameObservation(events: readonly ObservedGame[], fromDateUTC: string, throughDateUTC: string) {
  const eligible = events.filter(e => e.activity === 'cursor_game' && e.participation === 'user_engaged' && e.executedMs >= 1000
    && (e.cause === 'completed' || (e.cause === 'user_interrupted' && e.source === 'user' && e.triggerSequence !== null)));
  const completed = eligible.filter(e => e.cause === 'completed');
  const interruptedCount = eligible.length - completed.length;
  const completedUtcDays = new Set(completed.map(e => e.occurredAt.slice(0, 10))).size;
  if (completed.length < 6 || completedUtcDays < 3 || completed.length * 10 < eligible.length * 7 || eligible.at(-1)?.cause !== 'completed'
    || eligible.slice(-4).filter(e => e.cause === 'user_interrupted').length >= 2) return undefined;
  return { kind: 'shared_game_completions' as const, fromDateUTC, throughDateUTC, completedCount: completed.length, interruptedCount, completedUtcDays };
}
