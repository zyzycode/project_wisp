import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { RoutineCaptureIdentity, RoutineStoredStatus } from '../../application/ports/routine-observation.port';
import { routineObservation, routineStart } from './routine-validation';
import * as v from './validation';

const columns = 'dataset_epoch AS datasetEpoch, cohort_id AS cohortId, app_run_id AS appRunId, sequence, start_utc_ms AS startUtcMs, end_utc_ms AS endUtcMs, zone_id AS zoneId, offset_minutes AS offsetMinutes, local_date AS localDate, tuning_id AS tuningId, active_ms AS activeMs, inactive_ms AS inactiveMs, away_ms AS awayMs, unknown_ms AS unknownMs';
export class RoutineStore {
  constructor(private readonly db: Database.Database) {}
  private metadata() {
    const p = v.record(this.db.prepare("SELECT * FROM routine_metadata WHERE id='singleton'").get());
    return { datasetEpoch: v.text(p.dataset_epoch), cohortId: v.text(p.cohort_id), zoneId: p.zone_id === null ? null : v.text(p.zone_id), offsetMinutes: p.offset_minutes === null ? null : v.integer(p.offset_minutes, -840,840) };
  }
  begin(value: unknown): RoutineCaptureIdentity {
    const p = routineStart(value);
    return this.db.transaction(() => {
      const m = this.metadata();
      const latest = this.db.prepare('SELECT end_utc_ms AS end FROM routine_observations WHERE cohort_id=? ORDER BY end_utc_ms DESC LIMIT 1').get(m.cohortId);
      const backward = latest !== undefined && p.atUtcMs < v.finite(v.record(latest).end);
      const cohortId = p.forceNewCohort || m.zoneId !== p.zoneId || backward ? p.candidateCohortId : m.cohortId;
      if ((p.forceNewCohort || backward || (m.zoneId !== null && m.zoneId !== p.zoneId)) && cohortId === m.cohortId) throw new v.MemoryDataError('conflict');
      if (cohortId !== m.cohortId && this.db.prepare('SELECT 1 FROM routine_observations WHERE cohort_id=? LIMIT 1').get(cohortId) !== undefined) throw new v.MemoryDataError('conflict');
      this.db.prepare("UPDATE routine_metadata SET cohort_id=?,zone_id=?,offset_minutes=? WHERE id='singleton'").run(cohortId,p.zoneId,p.offsetMinutes);
      return { datasetEpoch: m.datasetEpoch, cohortId };
    }).immediate();
  }
  append(value: unknown): void {
    const p = routineObservation(value);
    this.db.transaction(() => {
      const m = this.metadata();
      if (p.datasetEpoch !== m.datasetEpoch || p.cohortId !== m.cohortId || p.zoneId !== m.zoneId) throw new v.MemoryDataError('conflict');
      const previous = this.db.prepare(`SELECT ${columns} FROM routine_observations WHERE app_run_id=? AND sequence=?`).get(p.appRunId,p.sequence);
      if (previous !== undefined) {
        if (JSON.stringify(routineObservation(previous)) !== JSON.stringify(p)) throw new v.MemoryDataError('conflict');
        return;
      }
      const before = this.db.prepare('SELECT end_utc_ms AS end FROM routine_observations WHERE cohort_id=? AND start_utc_ms<=? ORDER BY start_utc_ms DESC LIMIT 1').get(p.cohortId,p.startUtcMs);
      const after = this.db.prepare('SELECT start_utc_ms AS start FROM routine_observations WHERE cohort_id=? AND start_utc_ms>? ORDER BY start_utc_ms LIMIT 1').get(p.cohortId,p.startUtcMs);
      if ((before !== undefined && v.finite(v.record(before).end) > p.startUtcMs) || (after !== undefined && v.finite(v.record(after).start) < p.endUtcMs)) throw new v.MemoryDataError('conflict');
      this.db.prepare('INSERT INTO routine_observations (dataset_epoch,cohort_id,app_run_id,sequence,start_utc_ms,end_utc_ms,zone_id,offset_minutes,local_date,tuning_id,active_ms,inactive_ms,away_ms,unknown_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(p.datasetEpoch,p.cohortId,p.appRunId,p.sequence,p.startUtcMs,p.endUtcMs,p.zoneId,p.offsetMinutes,p.localDate,p.tuningId,p.activeMs,p.inactiveMs,p.awayMs,p.unknownMs);
    }).immediate();
  }
  read(): RoutineStoredStatus {
    const m = this.metadata();
    const latest = this.db.prepare('SELECT end_utc_ms AS end,zone_id AS zone,offset_minutes AS offset FROM routine_observations ORDER BY receipt DESC LIMIT 1').get();
    return { datasetEpoch: m.datasetEpoch, cohortId: m.cohortId, latestEndUtcMs: latest === undefined ? null : v.finite(v.record(latest).end), zoneId: latest === undefined ? null : v.text(v.record(latest).zone), offsetMinutes: latest === undefined ? null : v.integer(v.record(latest).offset,-840,840) };
  }
  /** Caller owns the full-memory transaction. */
  clear(): void {
    this.db.exec('DELETE FROM routine_observations;');
    this.db.prepare("UPDATE routine_metadata SET dataset_epoch=?,cohort_id=?,zone_id=NULL,offset_minutes=NULL WHERE id='singleton'").run(randomUUID(),randomUUID());
  }
}
