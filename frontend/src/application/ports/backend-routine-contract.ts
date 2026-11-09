/** WORLD-A01 bounded ordinary-chat wire projection; independent from local source identity. */
export interface BackendRoutineHypothesis {
  readonly scope: 'while_wisp_running';
  readonly validity: 'tentative';
  readonly windowStartHour: 0 | 6 | 12 | 18;
  readonly eligibleDays: number;
  readonly positiveDays: number;
  readonly recentPositiveDays: number;
  readonly observedThroughDate: string;
}
