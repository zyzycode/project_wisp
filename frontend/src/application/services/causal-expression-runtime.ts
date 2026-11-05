import type { CausalEmotion } from '../../domain/character/causal-affect';
import { directCausalExpression } from '../../domain/character/causal-director';
import type { CausalExpressionProjection } from '../ports/causal-life.interface';
import type { CausalExpressionCapture, ICausalExpressionRuntime } from '../ports/causal-expression';

export interface CausalDirectorState {
  readonly generation: number;
  readonly owner: string | null;
  readonly activeRunId: string | null;
  readonly consent: boolean;
  readonly romanceAllowed: boolean;
  readonly emotion: CausalEmotion | null;
  readonly deferredInvitation: boolean;
  readonly ownBookInterest?: CausalExpressionProjection['ownActivityInterest'];
  readonly ownGameInterest: CausalExpressionProjection['ownActivityInterest'];
}

/** Captures one existing local decision; it never starts inference, activities or effects. */
export class CausalExpressionRuntime implements ICausalExpressionRuntime {
  constructor(private readonly options: { readonly now: () => number; readonly read: () => CausalDirectorState }) {}
  capture(requestId: string): CausalExpressionCapture | undefined {
    const now = this.options.now(), current = this.decision();
    if (!current || !Number.isFinite(now) || now < 0) return undefined;
    return { requestId, sourceSequence: current.decision.sourceSequence, signature: current.signature,
      deadlineMs: now + 5000, expression: { ...current.decision.expression }, voiceProsody: 'neutral' };
  }
  isCurrent(capture: CausalExpressionCapture): boolean { return this.decision()?.signature === capture.signature; }
  private decision() {
    const state = this.options.read();
    if (state.owner === null || !Number.isSafeInteger(state.generation) || state.generation < 0) return undefined;
    const decision = directCausalExpression(state.emotion, state.deferredInvitation, state.emotion?.activity === 'book' ? state.ownBookInterest ?? 'none' : state.ownGameInterest);
    return decision && { decision, signature: JSON.stringify([state.generation, state.owner, state.activeRunId,
      state.consent, state.romanceAllowed, decision.sourceSequence, decision.expression]) };
  }
}
