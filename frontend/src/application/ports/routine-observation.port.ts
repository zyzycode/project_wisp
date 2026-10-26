import type { MemoryOperationContext, MemoryResult } from './memory-repository.interface';

/** Persisted dataset identity and comparable calendar; independent of memory generation. */
export interface RoutineCaptureIdentity {
  readonly datasetEpoch: string;
  readonly cohortId: string;
}
export interface RoutineObservation extends RoutineCaptureIdentity {
  readonly appRunId: string;
  readonly sequence: number;
  readonly startUtcMs: number;
  readonly endUtcMs: number;
  readonly zoneId: string;
  readonly offsetMinutes: number;
  readonly localDate: string;
  readonly tuningId: 'AFK-A01-v1';
  readonly activeMs: number;
  readonly inactiveMs: number;
  readonly awayMs: number;
  readonly unknownMs: number;
}
/** begin never deletes history; rotate only for explicit calendar/clock discontinuity. */
export interface RoutineCaptureStart {
  readonly atUtcMs: number;
  readonly zoneId: string;
  readonly offsetMinutes: number;
  readonly candidateCohortId: string;
  readonly forceNewCohort: boolean;
}
export interface RoutineStoredStatus extends RoutineCaptureIdentity {
  readonly latestEndUtcMs: number | null;
  readonly zoneId: string | null;
  readonly offsetMinutes: number | null;
}
export interface IRoutineObservationRepository {
  begin(input: RoutineCaptureStart, context: MemoryOperationContext): Promise<MemoryResult<RoutineCaptureIdentity>>;
  append(record: RoutineObservation, context: MemoryOperationContext): Promise<MemoryResult<void>>;
  readStatus(context: MemoryOperationContext): Promise<MemoryResult<RoutineStoredStatus>>;
}
/** Explicit semantic inputs; no raw idle values are persisted. */
export interface RoutineSample {
  readonly nowMs: number;
  readonly utcMs: number;
  readonly zoneId: string | null;
  readonly offsetMinutes: number;
  readonly localDate: string;
  readonly continuity: number;
  readonly sequence: number;
  readonly presence: 'active' | 'inactive' | 'probably_away' | 'unknown';
  readonly positiveAvailable: boolean;
}
