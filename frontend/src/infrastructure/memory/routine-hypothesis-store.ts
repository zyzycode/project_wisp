import type Database from 'better-sqlite3';
import { aggregateRoutineAvailability } from '../../domain/behavior/routine-availability';
import type { RoutineAvailabilityRow } from '../../domain/behavior/routine-availability';
import type { RoutineEvidencePage } from '../../application/ports/world-context.interface';
import { routineObservation } from './routine-validation';
import { routineQuery, routineSuppression } from './routine-hypothesis-validation';
import * as v from './validation';

export const ROUTINE_HYPOTHESIS_SCHEMA = `CREATE TABLE routine_suppression (
  window_start INTEGER PRIMARY KEY CHECK(window_start IN (0,6,12,18)),
  suppressed INTEGER NOT NULL CHECK(suppressed IN (0,1)));
  INSERT INTO routine_suppression VALUES (0,0),(6,0),(12,0),(18,0);
  CREATE INDEX routine_cohort_date_start ON routine_observations(cohort_id,local_date,start_utc_ms);`;
class RoutineOmission extends Error {}
const columns = 'dataset_epoch AS datasetEpoch, cohort_id AS cohortId, app_run_id AS appRunId, sequence, start_utc_ms AS startUtcMs, end_utc_ms AS endUtcMs, zone_id AS zoneId, offset_minutes AS offsetMinutes, local_date AS localDate, tuning_id AS tuningId, active_ms AS activeMs, inactive_ms AS inactiveMs, away_ms AS awayMs, unknown_ms AS unknownMs';
/** One indexed bounded read and at most one predecessor, in the existing worker. */
export class RoutineHypothesisStore {
  constructor(private readonly db: Database.Database) {}
  read(value: unknown): RoutineEvidencePage {
    const q = routineQuery(value), started = performance.now();
    const deadline = () => Date.now() >= q.expiresAtUtcMs || performance.now() - started >= 200;
    if (deadline()) return { counts:null, suppressed:true };
    let suppression = true;
    try { return this.db.transaction(() => {
      const metadata = v.record(this.db.prepare("SELECT * FROM routine_metadata WHERE id='singleton'").get());
      const suppressed = v.integer(v.record(this.db.prepare('SELECT suppressed FROM routine_suppression WHERE window_start=?').get(q.windowStartHour)).suppressed,0,1) === 1;
      suppression = suppressed;
      if (metadata.dataset_epoch !== q.datasetEpoch || metadata.cohort_id !== q.cohortId || metadata.zone_id !== q.zoneId) return { counts:null, suppressed };
      const firstDate = new Date(Date.parse(q.beforeLocalDate) - 28 * 86_400_000).toISOString().slice(0,10);
      let bytes = 0;
      const consume = (raw: unknown): RoutineAvailabilityRow => {
        bytes += Buffer.byteLength(JSON.stringify(raw), 'utf8');
        if (bytes > 4 * 1024 * 1024 || deadline()) throw new RoutineOmission();
        return routineObservation(raw);
      };
      const predecessorRaw = this.db.prepare(`SELECT ${columns} FROM routine_observations INDEXED BY routine_cohort_date_start WHERE cohort_id=? AND local_date<? ORDER BY local_date DESC, start_utc_ms DESC LIMIT 1`).get(q.cohortId,firstDate);
      const predecessor = predecessorRaw === undefined ? undefined : consume(predecessorRaw);
      const rows: RoutineAvailabilityRow[] = [];
      const limit = predecessor ? 10_000 : 10_001;
      for (const raw of this.db.prepare(`SELECT ${columns} FROM routine_observations INDEXED BY routine_cohort_date_start WHERE cohort_id=? AND local_date>=? AND local_date<? LIMIT ?`).iterate(q.cohortId,firstDate,q.beforeLocalDate,limit)) {
        if (rows.length + (predecessor ? 1 : 0) >= 10_000) return { counts:null, suppressed };
        rows.push(consume(raw));
      }
      if (deadline()) return { counts:null, suppressed };
      const counts = aggregateRoutineAvailability({ ...q, currentLocalDate:q.beforeLocalDate, rows, ...(predecessor ? { predecessor } : {}) });
      if (deadline()) return { counts:null, suppressed };
      return { counts, suppressed };
    })(); } catch (error) { if (error instanceof RoutineOmission) return { counts:null, suppressed:suppression }; throw error; }
  }
  suppress(value: unknown): void {
    const p = routineSuppression(value);
    this.db.prepare('UPDATE routine_suppression SET suppressed=? WHERE window_start=?').run(p.suppressed ? 1 : 0,p.window);
  }
  clear(): void { this.db.exec('UPDATE routine_suppression SET suppressed=0;'); }
}
