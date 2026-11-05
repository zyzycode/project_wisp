import type { CausalEmotion, CausalObservedEvent } from './causal-affect';
import type { CausalSourceReference } from './types';
import type { InterpretationStatus } from './social-interpretation';

export type CopingStrategy = 'pause' | 'explore';
interface Opportunity {
  readonly source: CausalSourceReference;
  readonly generation: number;
  readonly expiresAtMs: number;
}
export interface CopingState {
  readonly highWater: { readonly appRunId: string; readonly sequence: number; readonly generation: number } | null;
  readonly opportunity: Opportunity | null;
  readonly choice: (Opportunity & { readonly strategy: CopingStrategy; readonly selected: boolean }) | null;
  readonly run: (Opportunity & { readonly runId: string; readonly startedAtMs: number }) | null;
}
export interface CopingContext {
  readonly nowMs: number;
  readonly generation: number;
  readonly appRunId: string;
  readonly emotion: CausalEmotion | null;
}
export const createCopingState = (): CopingState => ({ highWater: null, opportunity: null, choice: null, run: null });
export function cancelCoping(state: CopingState): CopingState {
  return { ...state, opportunity: null, choice: null, run: null };
}
function current(opportunity: Opportunity, context: CopingContext): boolean {
  return Number.isFinite(context.nowMs) && context.nowMs >= 0 && opportunity.generation === context.generation
    && context.nowMs >= opportunity.expiresAtMs - 30000
    && opportunity.source.appRunId === context.appRunId && context.emotion?.causeSequence === opportunity.source.sequence
    && context.emotion.activity === 'cursor_game' && context.emotion.cause === 'user_interrupted' && context.emotion.kind === 'irritated' && context.emotion.target === 'user'
    && Number.isFinite(context.emotion.intensity) && context.emotion.intensity >= .05 && context.emotion.intensity <= 1;
}
export function observeCoping(state: CopingState, episode: CausalObservedEvent & CausalSourceReference,
  emotion: CausalEmotion | null, atMs: number, generation: number): CopingState {
  if (!Number.isFinite(atMs) || atMs < 0 || !Number.isSafeInteger(generation) || generation < 0
    || !episode.appRunId.trim() || !Number.isSafeInteger(episode.sequence) || episode.sequence < 1
    || (state.highWater?.generation === generation && state.highWater.appRunId === episode.appRunId
      && episode.sequence <= state.highWater.sequence)) return state;
  const next: CopingState = { ...cancelCoping(state), highWater: { appRunId: episode.appRunId, sequence: episode.sequence, generation } };
  if (episode.revision !== 1 || episode.activity !== 'cursor_game' || episode.outcome !== 'cancelled'
    || episode.cause !== 'user_interrupted' || episode.source !== 'user' || !episode.activityRunId
    || episode.triggerSequence === null || !Number.isSafeInteger(episode.triggerSequence) || episode.triggerSequence < 1 || episode.triggerSequence >= episode.sequence
    || !Number.isFinite(episode.executedMs) || episode.executedMs < 1000 || episode.executedMs > 600000 || !emotion
    || emotion.causeSequence !== episode.sequence || emotion.kind !== 'irritated'
    || !Number.isFinite(emotion.intensity) || emotion.intensity < .2 || emotion.intensity > 1) return next;
  return { ...next, opportunity: { source: { appRunId: episode.appRunId, sequence: episode.sequence, revision: 1 },
    generation, expiresAtMs: atMs + 30000 } };
}
/** One free P4 consideration consumes the opportunity even when another family wins. */
export function considerCoping(state: CopingState, context: CopingContext & {
  readonly free: boolean; readonly menu: boolean; readonly blocked: boolean;
  readonly interpretation: InterpretationStatus; readonly comfort: number;
}): CopingState {
  const opportunity = state.opportunity;
  if (context.blocked || (opportunity && (!current(opportunity, context) || context.nowMs >= opportunity.expiresAtMs))) return cancelCoping(state);
  if (!opportunity) return { ...state, choice: null };
  if (context.menu || !context.free) return state;
  const strategy = context.interpretation === 'reported_accidental' && Number.isFinite(context.comfort) && context.comfort >= 500
    ? 'explore' : 'pause';
  return { ...state, opportunity: null, choice: { ...opportunity, strategy, selected: false } };
}
export function copingSelectionMultiplier(strategy: CopingStrategy | null | undefined, kind: string): number {
  return (strategy === 'pause' && kind === 'idle') || (strategy === 'explore' && kind === 'wander') ? 1.2 : 1;
}
export function selectCoping(state: CopingState, kind: string, applied: boolean): CopingState {
  const choice = state.choice;
  return { ...state, choice: choice && applied && copingSelectionMultiplier(choice.strategy, kind) > 1
    ? { ...choice, selected: true } : null };
}
export function commitCoping(state: CopingState, runId: string, activityId: string, context: CopingContext): CopingState {
  const choice = state.choice;
  const matches = choice && choice.selected && (choice.strategy === 'pause' ? activityId === 'calm' : activityId === 'explore');
  return { ...state, choice: null, run: matches && runId && current(choice, context) && context.nowMs < choice.expiresAtMs
    ? { source: choice.source, generation: choice.generation, expiresAtMs: choice.expiresAtMs, runId, startedAtMs: context.nowMs } : null };
}
export function finishCoping(state: CopingState, runId: string, completed: boolean, context: CopingContext): {
  readonly state: CopingState; readonly relief: CausalSourceReference | null;
} {
  const run = state.run;
  if (!run || run.runId !== runId) return { state, relief: null };
  return { state: { ...state, run: null }, relief: completed && current(run, context) && context.nowMs >= run.startedAtMs ? run.source : null };
}
