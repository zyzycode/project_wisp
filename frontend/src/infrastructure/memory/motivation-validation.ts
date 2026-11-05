import type { MotivationRecord, OwnGoal, OwnPlan } from '../../application/ports/motivation.interface';
import { integer, MemoryDataError, record, text, timestamp } from './validation-primitives';

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new MemoryDataError('invalid_data');
  return value;
}
function goal(value: unknown): OwnGoal {
  const p = record(value, ['id', 'kind', 'createdAt', 'expiresAt', 'status']);
  if (p.kind !== 'recover_energy' && p.kind !== 'seek_novelty') throw new MemoryDataError('invalid_data');
  if (p.status !== 'pending' && p.status !== 'completed' && p.status !== 'cancelled'
    && p.status !== 'expired' && p.status !== 'abandoned') throw new MemoryDataError('invalid_data');
  const createdAt = timestamp(p.createdAt), expiresAt = timestamp(p.expiresAt);
  if (Date.parse(expiresAt) - Date.parse(createdAt) !== 600_000) throw new MemoryDataError('invalid_data');
  return { id: text(p.id), kind: p.kind, createdAt, expiresAt, status: p.status };
}
function plan(value: unknown, goals: readonly OwnGoal[]): OwnPlan | null {
  if (value === null) return null;
  const p = record(value, ['goalId', 'steps', 'stepIndex', 'attempts', 'claim']);
  const goalId = text(p.goalId);
  if (!goals.some(g => g.id === goalId && g.kind === 'seek_novelty' && g.status === 'pending')
    || !Array.isArray(p.steps) || p.steps.length < 2 || p.steps.length > 3) throw new MemoryDataError('invalid_data');
  const steps = p.steps.map((step: unknown) => {
    if (step !== 'rest' && step !== 'explore' && step !== 'calm_look_around') throw new MemoryDataError('invalid_data');
    return step;
  });
  if (steps.join(',') !== 'explore,calm_look_around' && steps.join(',') !== 'rest,explore,calm_look_around') throw new MemoryDataError('invalid_data');
  let claim: OwnPlan['claim'] = null;
  if (p.claim !== null) {
    const c = record(p.claim, ['appRunId', 'stepToken', 'runId']);
    claim = { appRunId: text(c.appRunId), stepToken: text(c.stepToken), runId: c.runId === null ? null : text(c.runId) };
  }
  const stepIndex = integer(p.stepIndex, 0, steps.length - 1), attempts = integer(p.attempts, 0, 3);
  if (attempts < stepIndex || (claim && attempts >= 3)) throw new MemoryDataError('invalid_data');
  return { goalId, steps, stepIndex, attempts, claim };
}
export function motivationRecord(value: unknown): MotivationRecord {
  const p = record(value, ['revision', 'goals', 'plan', 'noveltyArmed', 'recoveryArmed', 'lastSeenAt']);
  if (!Array.isArray(p.goals) || p.goals.length > 2) throw new MemoryDataError('invalid_data');
  const goals = p.goals.map(goal), lastSeenAt = timestamp(p.lastSeenAt);
  if (new Set(goals.map(g => g.kind)).size !== goals.length || new Set(goals.map(g => g.id)).size !== goals.length
    || goals.some(g => g.createdAt > lastSeenAt)) throw new MemoryDataError('invalid_data');
  return { revision: integer(p.revision, 1), goals, plan: plan(p.plan, goals),
    noveltyArmed: boolean(p.noveltyArmed), recoveryArmed: boolean(p.recoveryArmed), lastSeenAt };
}
