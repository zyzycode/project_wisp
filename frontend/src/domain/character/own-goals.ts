export type OwnGoalKind = 'recover_energy' | 'seek_novelty';
export interface OwnGoal {
  readonly id: string;
  readonly kind: OwnGoalKind;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: 'pending' | 'completed' | 'cancelled' | 'expired' | 'abandoned';
}
export interface GoalPlan {
  readonly goalId: string;
  readonly steps: readonly ('rest' | 'explore' | 'calm_look_around')[];
  readonly stepIndex: number;
  readonly attempts: number;
  readonly claim: null | { readonly appRunId: string; readonly stepToken: string; readonly runId: string | null };
}
export interface OwnMotivation {
  readonly revision: number;
  readonly goals: readonly OwnGoal[];
  readonly plan: GoalPlan | null;
  readonly noveltyArmed: boolean;
  readonly recoveryArmed: boolean;
  readonly lastSeenAt: string;
}
export interface GoalNeeds { readonly energy: number; readonly boredom?: number; }
const TTL_MS = 600_000;
export function validGoalNeeds(needs: GoalNeeds): boolean {
  return [needs.energy, needs.boredom].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100);
}
export function initialMotivation(now: string): OwnMotivation {
  return { revision: 0, goals: [], plan: null, noveltyArmed: true, recoveryArmed: true, lastSeenAt: now };
}
function changed(previous: OwnMotivation, next: OwnMotivation): OwnMotivation {
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : { ...next, revision: previous.revision + 1 };
}
/** Clock and expiry maintenance never invent a need or replay an Activity. */
export function settleOwnGoals(record: OwnMotivation, now: string): OwnMotivation {
  const at = Date.parse(now), last = Date.parse(record.lastSeenAt);
  if (!Number.isFinite(at) || !Number.isFinite(last)) return record;
  const backwards = at < last;
  const goals = record.goals.map(goal => goal.status !== 'pending' ? goal
    : backwards || Date.parse(goal.createdAt) > at ? { ...goal, status: 'cancelled' as const }
    : at >= Date.parse(goal.expiresAt) ? { ...goal, status: 'expired' as const } : goal);
  const plan = record.plan && goals.some(g => g.id === record.plan?.goalId && g.status === 'pending') ? record.plan : null;
  return changed(record, { ...record, goals, plan, lastSeenAt: backwards ? record.lastSeenAt : now,
    ...(backwards ? { recoveryArmed: false, noveltyArmed: false } : {}) });
}
/** Fresh local opportunity only; IDs and wall time are supplied by the caller. */
export function evaluateOwnGoals(record: OwnMotivation, needs: GoalNeeds, now: string,
  createId: (kind: OwnGoalKind) => string): OwnMotivation {
  if (!Number.isFinite(Date.parse(now)) || !Number.isFinite(Date.parse(record.lastSeenAt))) return record;
  const settled = settleOwnGoals(record, now);
  if (!validGoalNeeds(needs) || Date.parse(now) < Date.parse(settled.lastSeenAt)) return settled;
  let goals = settled.goals.map(goal => goal.status !== 'pending' ? goal
    : goal.kind === 'recover_energy' && needs.energy >= 60 ? { ...goal, status: 'completed' as const }
    : goal.kind === 'seek_novelty' && needs.boredom! < 40 ? { ...goal, status: 'cancelled' as const } : goal);
  let recoveryArmed = settled.recoveryArmed || needs.energy >= 60;
  let noveltyArmed = settled.noveltyArmed || needs.boredom! < 40;
  const add = (kind: OwnGoalKind) => {
    const current = goals.find(goal => goal.kind === kind);
    if (current?.status === 'pending') return false;
    const goal: OwnGoal = { id: createId(kind), kind, createdAt: now,
      expiresAt: new Date(Date.parse(now) + TTL_MS).toISOString(), status: 'pending' };
    goals = [...goals.filter(previous => previous.kind !== kind), goal];
    return true;
  };
  if (recoveryArmed && needs.energy < 40 && add('recover_energy')) recoveryArmed = false;
  if (noveltyArmed && needs.boredom! >= 60 && needs.energy >= 30 && add('seek_novelty')) noveltyArmed = false;
  // One revision represents the whole local evaluation, including clock maintenance.
  return changed(record, { ...settled, revision: record.revision, goals, recoveryArmed, noveltyArmed });
}
export function activeOwnGoal(record: OwnMotivation | null, needs: GoalNeeds, now: string): OwnGoal | null {
  if (!record || !validGoalNeeds(needs) || !Number.isFinite(Date.parse(now))
    || Date.parse(now) < Date.parse(record.lastSeenAt)) return null;
  const pending = record.goals.filter(goal => goal.status === 'pending' && (goal.kind === 'recover_energy' ? needs.energy < 60 : needs.boredom! >= 40)
    && Date.parse(goal.createdAt) <= Date.parse(now) && Date.parse(now) < Date.parse(goal.expiresAt));
  const recovery = pending.find(goal => goal.kind === 'recover_energy');
  const novelty = pending.find(goal => goal.kind === 'seek_novelty');
  return recovery && needs.energy < 45 ? recovery : novelty ?? recovery ?? null;
}
export function ownGoalMultiplier(record: OwnMotivation | null, needs: GoalNeeds, now: string,
  activity: string, allowed: boolean): number {
  const goal = allowed ? activeOwnGoal(record, needs, now) : null;
  return ownGoalSelectionMultiplier(goal?.kind, activity);
}
export function ownGoalSelectionMultiplier(goal: OwnGoalKind | null | undefined, activity: string): number {
  return (goal === 'recover_energy' && activity === 'sleep') || (goal === 'seek_novelty' && activity === 'wander') ? 1.2 : 1;
}
export function ownGoalActivityKind(activityId: string): OwnGoalKind | null {
  if (activityId === 'explore') return 'seek_novelty';
  return ['rest', 'rest_spot_nap', 'rest_spot_sleep'].includes(activityId) ? 'recover_energy' : null;
}
export function finishOwnGoal(record: OwnMotivation, goalId: string, outcome: 'completed' | 'cancelled' | 'failed', now: string): OwnMotivation {
  if (!Number.isFinite(Date.parse(now))) return record;
  const settled = settleOwnGoals(record, now);
  const goals = settled.goals.map(goal => goal.id === goalId && goal.status === 'pending'
    ? { ...goal, status: outcome === 'completed' ? 'completed' as const : 'cancelled' as const } : goal);
  return changed(record, { ...settled, revision: record.revision, goals });
}
export function cancelOwnGoals(record: OwnMotivation, now: string): OwnMotivation {
  if (!Number.isFinite(Date.parse(now))) return record;
  const settled = settleOwnGoals(record, now);
  return changed(record, { ...settled, revision: record.revision, plan: null, recoveryArmed: false, noveltyArmed: false,
    goals: settled.goals.map(goal => goal.status === 'pending' ? { ...goal, status: 'cancelled' as const } : goal) });
}
