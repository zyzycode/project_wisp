import { settleOwnGoals, validGoalNeeds, type GoalNeeds, type GoalPlan, type OwnMotivation } from './own-goals';

export type OwnPlanStep = GoalPlan['steps'][number];
function changed(before: OwnMotivation, next: OwnMotivation): OwnMotivation {
  return JSON.stringify(before) === JSON.stringify(next) ? before : { ...next, revision: before.revision + 1 };
}
export function cancelOwnPlan(record: OwnMotivation, now: string, status: 'cancelled' | 'abandoned' = 'cancelled'): OwnMotivation {
  const settled = settleOwnGoals(record, now), id = settled.plan?.goalId;
  if (!id) return settled;
  return changed(record, { ...settled, plan: null,
    goals: settled.goals.map(goal => goal.id === id && goal.status === 'pending' ? { ...goal, status } : goal) });
}
/** Startup never revives a claim, and never turns a restored step into an execution. */
export function restoreOwnPlan(record: OwnMotivation, now: string): OwnMotivation {
  const settled = settleOwnGoals(record, now);
  return settled.plan?.claim ? cancelOwnPlan(settled, now, 'abandoned') : settled;
}
/** A fresh P4 observation is the only place that creates or rebuilds an unclaimed template. */
export function prepareOwnPlan(record: OwnMotivation, needs: GoalNeeds, now: string, restart = false): OwnMotivation {
  const settled = settleOwnGoals(record, now);
  if (!validGoalNeeds(needs)) return settled;
  const goal = settled.goals.find(candidate => candidate.kind === 'seek_novelty' && candidate.status === 'pending');
  if (!goal || settled.plan?.claim) return settled;
  const explored = settled.plan !== null && settled.plan.stepIndex > settled.plan.steps.indexOf('explore');
  if (needs.boredom! < 40 && !explored) {
    return changed(record, { ...settled, plan: null,
      goals: settled.goals.map(candidate => candidate.id === goal.id ? { ...candidate, status: 'cancelled' as const } : candidate) });
  }
  if (settled.plan && !restart) return settled;
  const steps: readonly OwnPlanStep[] = needs.energy < 45 ? ['rest', 'explore', 'calm_look_around'] : ['explore', 'calm_look_around'];
  const attempts = settled.plan?.attempts ?? 0;
  if (attempts + steps.length > 3) {
    const plan = settled.plan ?? { goalId: goal.id, steps, stepIndex: 0, attempts, claim: null };
    return cancelOwnPlan({ ...settled, plan }, now, 'abandoned');
  }
  return changed(record, { ...settled, plan: { goalId: goal.id, steps, stepIndex: 0, attempts, claim: null } });
}
export function selectedOwnPlanStep(record: OwnMotivation | null, needs: GoalNeeds, now: string): OwnPlanStep | null {
  const plan = record?.plan;
  if (!record || !plan || plan.claim || plan.attempts >= 3 || !validGoalNeeds(needs)
    || !Number.isFinite(Date.parse(now)) || now < record.lastSeenAt) return null;
  const goal = record.goals.find(candidate => candidate.id === plan.goalId && candidate.status === 'pending');
  if (!goal || now < goal.createdAt || now >= goal.expiresAt) return null;
  const step = plan.steps[plan.stepIndex];
  const explored = plan.stepIndex > plan.steps.indexOf('explore');
  if ((!explored && needs.boredom! < 40) || ((step === 'explore' || step === 'calm_look_around') && needs.energy < 30)) return null;
  return step ?? null;
}
export function ownPlanSelectionMultiplier(step: OwnPlanStep | null | undefined, activity: string): number {
  return (step === 'rest' && activity === 'sleep') || (step === 'explore' && activity === 'wander')
    || (step === 'calm_look_around' && activity === 'idle') ? 1.2 : 1;
}
export function ownPlanActivityMatches(step: OwnPlanStep, activityId: string): boolean {
  return step === 'rest' ? ['rest', 'rest_spot_nap', 'rest_spot_sleep'].includes(activityId)
    : step === 'explore' ? activityId === 'explore' : activityId === 'calm';
}
export function claimOwnPlan(record: OwnMotivation, needs: GoalNeeds, now: string, appRunId: string, stepToken: string): OwnMotivation | null {
  if (!selectedOwnPlanStep(record, needs, now) || !appRunId.trim() || !stepToken.trim()) return null;
  return { ...record, revision: record.revision + 1, lastSeenAt: now,
    plan: { ...record.plan!, claim: { appRunId, stepToken, runId: null } } };
}
/** Only a live runtime binding supplies run identity; a persisted claim is not completion evidence. */
export function finishOwnPlan(record: OwnMotivation, now: string, proof: {
  readonly appRunId: string; readonly stepToken: string; readonly runId: string;
  readonly result: 'completed' | 'cancelled' | 'failed';
}): OwnMotivation {
  const settled = settleOwnGoals(record, now), plan = settled.plan;
  if (!plan?.claim || plan.claim.appRunId !== proof.appRunId || plan.claim.stepToken !== proof.stepToken
    || (plan.claim.runId !== null && plan.claim.runId !== proof.runId) || !proof.runId) return settled;
  if (proof.result !== 'completed') return cancelOwnPlan(settled, now);
  const step = plan.steps[plan.stepIndex], attempts = plan.attempts + 1, index = plan.stepIndex + 1;
  const goals = settled.goals.map(goal => step === 'rest' && goal.kind === 'recover_energy' && goal.status === 'pending'
    ? { ...goal, status: 'completed' as const } : goal);
  if (index >= plan.steps.length) return changed(record, { ...settled, goals: goals.map(goal => goal.id === plan.goalId
    ? { ...goal, status: 'completed' as const } : goal), plan: null });
  if (attempts >= 3) return cancelOwnPlan({ ...settled, goals }, now, 'abandoned');
  return changed(record, { ...settled, goals, plan: { ...plan, stepIndex: index, attempts, claim: null } });
}
