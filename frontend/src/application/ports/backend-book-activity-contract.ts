/** Independent target #183 wire declarations; active requests remain unchanged here. */
export interface BookCompatibleCausalExpression {
  readonly activity: 'contact' | 'cursor_game' | 'book';
  readonly intent: 'respond' | 'acknowledge' | 'give_space' | 'continue_activity';
  readonly emotion: 'content' | 'curious' | 'irritated';
  readonly intensity: 'low' | 'moderate';
  readonly target: 'user' | 'environment' | 'self';
  readonly cause: 'contact' | 'completed' | 'user_interrupted' | 'environment_lost' | 'timeout';
  readonly deferredInvitation: boolean;
  readonly ownActivityInterest: 'none' | 'emerging' | 'established';
}
/** Same fields for source-only event summary and a causal_event recalled episode. */
export interface BackendBookHistoryEvent {
  readonly activity: 'book';
  readonly outcome: 'completed' | 'cancelled' | 'failed';
  readonly cause: 'completed' | 'user_interrupted' | 'environment_lost' | 'timeout';
  readonly actor: 'user' | 'system' | 'autonomy' | 'unknown';
  readonly participation: 'solitary';
  readonly executedMs: number;
  readonly occurredAt: string;
}
export interface BackendBookMemoryEpisode extends BackendBookHistoryEvent {
  readonly kind: 'causal_event';
}
