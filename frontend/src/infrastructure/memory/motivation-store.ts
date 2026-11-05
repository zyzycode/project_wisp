import type Database from 'better-sqlite3';
import type { MotivationRecord } from '../../application/ports/motivation.interface';
import { settleOwnGoals } from '../../domain/character/own-goals';
import { restoreOwnPlan } from '../../domain/character/own-plans';
import { motivationRecord } from './motivation-validation';
import { integer, MemoryDataError, record, text, timestamp } from './validation-primitives';

export const MOTIVATION_SCHEMA = `CREATE TABLE own_motivation (singleton INTEGER PRIMARY KEY CHECK(singleton=1), payload TEXT NOT NULL);`;
export class MotivationStore {
  constructor(private readonly db: Database.Database) {}
  read(value: unknown, startup = false): MotivationRecord | null {
    const now = timestamp(value);
    return this.db.transaction(() => {
      const current = this.current();
      if (!current) return null;
      const next = startup ? restoreOwnPlan(current, now) : settleOwnGoals(current, now);
      if (next !== current) this.save(motivationRecord(next));
      return next;
    }).immediate();
  }
  replace(value: unknown): void {
    const p = record(value, ['value', 'expectedRevision']);
    const next = motivationRecord(p.value), expected = p.expectedRevision === null ? null : integer(p.expectedRevision, 1);
    this.db.transaction(() => {
      const current = this.current();
      if (current && JSON.stringify(current) === JSON.stringify(next)) return;
      if ((current?.revision ?? null) !== expected || next.revision !== (expected ?? 0) + 1) throw new MemoryDataError('conflict');
      if (current && next.lastSeenAt < current.lastSeenAt) throw new MemoryDataError('conflict');
      for (const goal of next.goals) {
        const previous = current?.goals.find(g => g.id === goal.id);
        if (previous && (previous.kind !== goal.kind || previous.createdAt !== goal.createdAt || previous.expiresAt !== goal.expiresAt
          || (previous.status !== 'pending' && previous.status !== goal.status))) throw new MemoryDataError('conflict');
      }
      validatePlanTransition(current, next);
      this.save(next);
    }).immediate();
  }
  clear(): void { this.db.exec('DELETE FROM own_motivation;'); }
  private current(): MotivationRecord | null {
    const row = this.db.prepare('SELECT payload FROM own_motivation WHERE singleton=1').get();
    return row ? motivationRecord(JSON.parse(text(record(row).payload, 8192))) : null;
  }
  private save(value: MotivationRecord): void {
    this.db.prepare('INSERT INTO own_motivation VALUES (1,?) ON CONFLICT(singleton) DO UPDATE SET payload=excluded.payload').run(JSON.stringify(value));
  }
}

/** CAS cannot be used to recycle a claimed step or advance without one acknowledged claim. */
function validatePlanTransition(current: MotivationRecord | null, next: MotivationRecord): void {
  const previous = current?.plan, plan = next.plan;
  if (!previous) {
    if (plan && (plan.claim !== null || plan.stepIndex !== 0 || plan.attempts !== 0)) throw new MemoryDataError('conflict');
    return;
  }
  if (!plan) {
    if (next.goals.some(goal => goal.id === previous.goalId && goal.status === 'pending')) throw new MemoryDataError('conflict');
    return;
  }
  const sameSteps = JSON.stringify(previous.steps) === JSON.stringify(plan.steps);
  if (plan.goalId !== previous.goalId) throw new MemoryDataError('conflict');
  if (previous.claim && plan.claim) {
    if (!sameSteps || previous.stepIndex !== plan.stepIndex || previous.attempts !== plan.attempts
      || previous.claim.stepToken !== plan.claim.stepToken || previous.claim.appRunId !== plan.claim.appRunId
      || (previous.claim.runId !== null && previous.claim.runId !== plan.claim.runId)) throw new MemoryDataError('conflict');
  } else if (previous.claim) {
    if (!sameSteps || plan.stepIndex !== previous.stepIndex + 1 || plan.attempts !== previous.attempts + 1) throw new MemoryDataError('conflict');
  } else if (plan.claim) {
    if (!sameSteps || plan.stepIndex !== previous.stepIndex || plan.attempts !== previous.attempts || plan.claim.runId !== null) throw new MemoryDataError('conflict');
  } else if (plan.attempts !== previous.attempts || (plan.stepIndex !== previous.stepIndex && plan.stepIndex !== 0)) {
    throw new MemoryDataError('conflict');
  }
}
