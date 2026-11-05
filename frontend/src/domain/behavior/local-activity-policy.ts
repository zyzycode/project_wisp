import type { CharacterAutonomySnapshot } from '../character/autonomy-character-engine';
import { localPreferenceMultiplier } from '../character/preferences';
import { causalEmotionMultiplier } from '../character/causal-affect';
import { ownGoalSelectionMultiplier, type OwnGoalKind } from '../character/own-goals';
import type { BehaviorIntent } from './behavior-intent';
export interface LocalSelectionContext {
  readonly nowMs: number;
  readonly canExplore: boolean;
  readonly canPlay: boolean;
  readonly canRest: boolean;
  readonly canSocial?: boolean;
  readonly quiet?: boolean;
  readonly ownGoal?: OwnGoalKind | null;
  readonly history: readonly { readonly kind: string; readonly atMs: number }[];
}
export interface LocalSelectionTrace {
  readonly kind: string;
  readonly eligible: boolean;
  readonly reason: string;
  readonly factors: { readonly need: number; readonly personality: number; readonly repetition: number };
  readonly baselineScore: number;
  readonly preferenceMultiplier: number;
  readonly emotionMultiplier: number;
  readonly goalMultiplier: number;
  readonly poolEligible: boolean;
  readonly selected: boolean;
  readonly score: number;
}
export const LOCAL_TUNING_VERSION = 'CE-I05-v1';
function optionalTrait(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1 ? value : .5;
}
function validNeed(value: number): boolean { return Number.isFinite(value) && value >= 0 && value <= 100; }
/** Pure weighted Utility after hard eligibility, with a bounded relative score pool. */
export function selectLocalActivity(snapshot: CharacterAutonomySnapshot, context: LocalSelectionContext, random: number): {
  readonly intent: BehaviorIntent; readonly trace: readonly LocalSelectionTrace[];
} {
  const n = snapshot.needs;
  const t = { openness: optionalTrait(snapshot.localTraits?.openness), playfulness: optionalTrait(snapshot.localTraits?.playfulness),
    independence: optionalTrait(snapshot.localTraits?.independence), extraversion: optionalTrait(snapshot.localTraits?.extraversion) };
  const definitions = [
    { kind: 'idle', eligible: true, need: .3 + (100 - n.energy + n.comfort) / 70, personality: .5 + t.independence },
    { kind: 'wander', eligible: context.canExplore, need: .2 + (n.boredom ?? 0) / 30, personality: .5 + t.openness },
    { kind: 'sleep', eligible: context.canRest, need: .05 + (100 - n.energy + n.comfort) / 140, personality: .5 + t.independence },
    { kind: 'play', eligible: context.canPlay && !context.quiet, need: n.play / 20 + (n.boredom ?? 0) / 25, personality: .5 + t.playfulness },
    { kind: 'social_bid', eligible: context.canSocial === true && !context.quiet && n.attention >= 80
      && (snapshot.relationship?.friendship ?? 0) >= 100, need: n.attention / 25,
      personality: (.5 + t.extraversion) * (.5 + (snapshot.relationship?.friendship ?? 0) / 1000) },
  ] as const;
  const weighted = definitions.map(d => {
    const repeat = context.history.filter(entry => entry.kind === d.kind).reduce((sum, entry) =>
      sum + Math.pow(.5, Math.max(0, context.nowMs - entry.atMs) / 90000), 0);
    const rawFactors = { need: d.need, personality: d.personality, repetition: Math.max(.15, 1 / (1 + repeat)) };
    const inputs = d.kind === 'idle' || d.kind === 'sleep' ? [n.energy, n.comfort]
      : d.kind === 'wander' ? [n.boredom ?? 0] : d.kind === 'play' ? [n.play, n.boredom ?? 0] : [n.attention];
    const valid = inputs.every(validNeed) && Object.values(rawFactors).every(value => Number.isFinite(value) && value >= 0)
      && Number.isFinite(context.nowMs) && context.nowMs >= 0;
    const rawBaseline = valid ? rawFactors.need * rawFactors.personality * rawFactors.repetition : 0;
    const eligible = d.eligible && valid && Number.isFinite(rawBaseline);
    const factors = { need: valid ? rawFactors.need : 0, personality: valid ? rawFactors.personality : 0,
      repetition: valid ? rawFactors.repetition : 0 };
    const baselineScore = eligible ? rawBaseline : 0;
    const preferenceMultiplier = localPreferenceMultiplier(d.kind === 'wander' ? snapshot.learnedExplorePreference
      : d.kind === 'social_bid' ? snapshot.learnedSocialBidPreference : undefined);
    const emotionMultiplier = d.kind === 'social_bid' ? causalEmotionMultiplier(snapshot.causalEmotion) : 1;
    const goalMultiplier = eligible ? ownGoalSelectionMultiplier(context.ownGoal, d.kind) : 1;
    return { kind: d.kind, eligible, reason: !d.eligible ? 'state_environment_cooldown_or_mode' : eligible ? 'eligible' : 'invalid_required_baseline',
      factors, baselineScore, preferenceMultiplier, emotionMultiplier, goalMultiplier,
      score: baselineScore * preferenceMultiplier * emotionMultiplier * Math.min(1.5, Math.max(.8, goalMultiplier)) };
  });
  const maximum = Math.max(...weighted.map(row => row.score));
  const trace = weighted.map(row => ({ ...row, poolEligible: row.score > 0 && row.score >= .5 * maximum }));
  let remaining = Math.max(0, Math.min(1 - Number.EPSILON, Number.isFinite(random) ? random : 0))
    * trace.reduce((sum, row) => sum + (row.poolEligible ? row.score : 0), 0);
  let winner = trace[0]!;
  for (const row of trace) {
    if (!row.poolEligible) continue;
    remaining -= row.score; if (remaining <= 0) { winner = row; break; }
  }
  const kind = definitions.find(d => d.kind === winner.kind)!.kind;
  // Reuse the uniformly distributed position within the selected family bucket.
  const poseRandom = winner.score > 0 ? (remaining + winner.score) / winner.score : 0;
  const poseWeights = (['idle_blink', 'look_around'] as const).map(pose => {
    const repeats = context.history.filter(entry => entry.kind === `calm:${pose}`).reduce((sum, entry) =>
      sum + Math.pow(.5, Math.max(0, context.nowMs - entry.atMs) / 90000), 0);
    return { pose, weight: (pose === 'idle_blink' ? 1.4 : 1) / (1 + repeats) };
  });
  const calmPose = poseRandom * (poseWeights[0]!.weight + poseWeights[1]!.weight) < poseWeights[0]!.weight
    ? 'idle_blink' : 'look_around';
  return { intent: { kind: kind === 'social_bid' ? 'play' : kind, source: 'timer', priority: 'normal',
    reason: 'local_utility', ...(kind === 'social_bid' ? { activityFamily: 'social_bid' } : {}),
    ...(kind === 'idle' ? { calmPose } : {}) }, trace: trace.map(row => ({ ...row, selected: row === winner })) };
}

/** Observation is a one-shot causal opportunity, never a scheduled Activity. */
export function isObservationEligible(gates: {
  readonly allowed: boolean; readonly busy: boolean; readonly higherSpeech: boolean;
  readonly thinking: boolean; readonly dialogueGuard: boolean; readonly budgetGuard: boolean;
}): boolean {
  return gates.allowed && !gates.busy && !gates.higherSpeech && !gates.thinking && !gates.dialogueGuard && !gates.budgetGuard;
}
