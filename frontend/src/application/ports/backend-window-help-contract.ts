/** Independent target #131 wire declarations; not active request union members yet. */
export type BackendWindowHelpRegion = 'upper_left' | 'upper_center' | 'upper_right'
  | 'middle_left' | 'middle_center' | 'middle_right'
  | 'lower_left' | 'lower_center' | 'lower_right';
export interface BackendWindowHelpEvent {
  readonly type: 'window_help_requested';
  readonly occurredAt: string;
  readonly targetRegion: BackendWindowHelpRegion;
}
export interface BackendPreviousWindowHelpInitiative {
  readonly kind: 'window_help';
  readonly text: string;
  readonly createdAt: string;
  readonly outcome: 'waiting' | 'assisting' | 'fulfilled' | 'declined' | 'unanswered' | 'cancelled' | 'target_lost';
}
