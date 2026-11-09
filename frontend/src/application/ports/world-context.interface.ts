import type { MemoryOperationContext, MemoryResult } from './memory-repository.interface';
import type { RoutineCaptureIdentity } from './routine-observation.port';

/** WORLD-A01 target: only normalized, session-scoped facts may reach Domain. */
export interface CurrentComputerContext {
  readonly generation: number;
  readonly sampledAtMs: number;
  readonly presence: 'active' | 'inactive' | 'probably_away' | 'unknown';
  readonly foreground: 'settling' | 'stable' | 'unknown';
}

export type RoutineWindowStart = 0 | 6 | 12 | 18;

export interface RoutineEvidenceQuery extends RoutineCaptureIdentity {
  readonly beforeLocalDate: string;
  readonly windowStartHour: RoutineWindowStart;
  readonly zoneId: string;
  readonly offsetMinutes: number;
  readonly nowUtcMs: number;
  readonly expiresAtUtcMs: number;
}

export interface RoutineEvidencePage {
  /** Bounded worker-side pure aggregation; no raw diary crosses the worker boundary. */
  readonly counts: import('../../domain/behavior/routine-availability').RoutineAvailabilityCounts | null;
  readonly suppressed: boolean;
}

export interface RoutineAvailabilityHypothesis extends RoutineCaptureIdentity {
  readonly windowStartHour: RoutineWindowStart;
  readonly eligibleDays: number;
  readonly positiveDays: number;
  readonly recentPositiveDays: number;
  readonly observedThroughDate: string;
}

/** Target additions to the existing worker, not another capture or storage owner. */
export interface IRoutineHypothesisRepository {
  readEvidence(query: RoutineEvidenceQuery, context: MemoryOperationContext): Promise<MemoryResult<RoutineEvidencePage>>;
  /** One persistent flag per fixed window; no free text or inferred user fact. */
  setSuppressed(window: RoutineWindowStart, suppressed: boolean, context: MemoryOperationContext): Promise<MemoryResult<void>>;
}

export interface RoutineSourceSnapshot extends RoutineCaptureIdentity {
  readonly revision: number;
  readonly zoneId: string;
  readonly offsetMinutes: number;
}
export interface RoutineHypothesisCapture {
  readonly epoch: number;
  readonly generation: number;
  readonly source: RoutineSourceSnapshot;
  readonly calendarKey: string;
  readonly context: import('./backend-routine-contract').BackendRoutineHypothesis;
}
