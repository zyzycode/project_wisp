import type { CharacterAutonomySnapshot } from '../character/autonomy-character-engine';
import type { BehaviorIntent } from './behavior-intent';
export interface LocalSelectionContext {
  readonly nowMs: number;
  readonly canExplore: boolean;
  readonly canPlay: boolean;
  readonly canRest: boolean;
  readonly canSocial?: boolean;
  readonly quiet?: boolean;
  readonly history: readonly { readonly kind: string; readonly atMs: number }[];
}
export interface LocalSelectionTrace {
  readonly kind: string;
  readonly eligible: boolean;
  readonly reason: string;
  readonly factors: { readonly need: number; readonly personality: number; readonly repetition: number };
  readonly score: number;
}
export const LOCAL_TUNING_VERSION = 'AUTO-I12-v1';
/** Pure weighted Utility after hard eligibility; history never bans the sole option. */
export function selectLocalActivity(snapshot: CharacterAutonomySnapshot, context: LocalSelectionContext, random: number): {
  readonly intent: BehaviorIntent; readonly trace: readonly LocalSelectionTrace[];
} {
  const n = snapshot.needs;
  const t = snapshot.localTraits ?? { openness: .5, playfulness: .5, independence: .5, extraversion: .5 };
  const definitions = [
    { kind: 'idle', eligible: true, need: .3 + (100 - n.energy + n.comfort) / 70, personality: .5 + t.independence },
    { kind: 'wander', eligible: context.canExplore, need: .2 + (n.boredom ?? 0) / 30, personality: .5 + t.openness },
    { kind: 'sleep', eligible: context.canRest, need: .05 + (100 - n.energy + n.comfort) / 140, personality: .5 + t.independence },
    { kind: 'play', eligible: context.canPlay && !context.quiet, need: n.play / 20 + (n.boredom ?? 0) / 25, personality: .5 + t.playfulness },
    { kind: 'social_bid', eligible: context.canSocial === true && !context.quiet, need: n.attention / 25,
      personality: (.5 + t.extraversion) * (.5 + (snapshot.relationship?.friendship ?? 0) / 1000) },
  ] as const;
  const trace = definitions.map(d => {
    const repeat = context.history.filter(entry => entry.kind === d.kind).reduce((sum, entry) =>
      sum + Math.pow(.5, Math.max(0, context.nowMs - entry.atMs) / 90000), 0);
    const factors = { need: d.need, personality: d.personality, repetition: Math.max(.15, 1 / (1 + repeat)) };
    return { kind: d.kind, eligible: d.eligible, reason: d.eligible ? 'eligible' : 'state_environment_cooldown_or_mode',
      factors, score: d.eligible ? factors.need * factors.personality * factors.repetition : 0 };
  });
  let remaining = Math.max(0, Math.min(.999999, Number.isFinite(random) ? random : 0)) * trace.reduce((sum, row) => sum + row.score, 0);
  let winner = trace[0]!;
  for (const row of trace) { remaining -= row.score; if (row.score > 0 && remaining <= 0) { winner = row; break; } }
  const kind = definitions.find(d => d.kind === winner.kind)!.kind;
  const lastPose = context.history.filter(entry => entry.kind.startsWith('calm:')).at(-1)?.kind;
  return { intent: { kind: kind === 'social_bid' ? 'play' : kind, source: 'timer', priority: 'normal',
    reason: 'local_utility', ...(kind === 'social_bid' ? { activityFamily: 'social_bid' } : {}),
    ...(kind === 'idle' ? { calmPose: lastPose === 'calm:look_around' ? 'idle_blink' : 'look_around' } : {}) }, trace };
}
