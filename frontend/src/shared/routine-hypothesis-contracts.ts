export type RoutineWindowDTO = 0 | 6 | 12 | 18;
export interface RoutineHypothesisStateDTO {
  readonly sharing: boolean;
  readonly available: boolean;
  readonly backendAvailable: boolean;
  readonly suppressed: boolean;
  readonly windowStartHour: RoutineWindowDTO;
  readonly counts: { readonly eligibleDays: number; readonly positiveDays: number; readonly recentPositiveDays: number; readonly observedThroughDate: string | null; readonly qualifies: boolean } | null;
}
export interface RoutineHypothesisReadDTO { readonly streamId: string }
export type RoutineHypothesisCommandDTO = { readonly streamId: string; readonly requestId: string; readonly sequence: number } & (
  { readonly kind: 'sharing'; readonly enabled: boolean }
  | { readonly kind: 'suppression'; readonly windowStartHour: RoutineWindowDTO; readonly suppressed: boolean });
export type RoutineHypothesisReadResultDTO = { readonly ok: true; readonly state: RoutineHypothesisStateDTO } | { readonly ok: false; readonly code: 'stale' | 'busy' | 'unavailable' };
export type RoutineHypothesisResultDTO = { readonly requestId: string } & ({ readonly ok: true } | { readonly ok: false; readonly code: 'stale' | 'busy' | 'unavailable' });
export interface RoutineHypothesisBridge {
  read(command: RoutineHypothesisReadDTO): Promise<RoutineHypothesisReadResultDTO>;
  command(command: RoutineHypothesisCommandDTO): Promise<RoutineHypothesisResultDTO>;
}
