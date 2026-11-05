import type { CausalEmotion } from './causal-affect';
import type { AnimationIntent } from '../animation/animation-intent';
import type { ActivityPriorityClass } from '../behavior/activity-runner';

/** Local meaning only. Application and wire boundaries declare their own forms. */
export interface CausalExpression {
  readonly intent: 'respond' | 'acknowledge' | 'give_space' | 'continue_activity';
  readonly emotion: 'content' | 'curious' | 'irritated';
  readonly intensity: 'low' | 'moderate';
  readonly target: 'user' | 'environment' | 'self';
  readonly cause: 'contact' | 'completed' | 'user_interrupted' | 'environment_lost' | 'timeout';
  readonly deferredInvitation: boolean;
  readonly ownGameInterest: 'none' | 'emerging' | 'established';
}

export function directCausalExpression(emotion: CausalEmotion | null, deferredInvitation: boolean,
  ownGameInterest: CausalExpression['ownGameInterest']): { readonly sourceSequence: number; readonly expression: CausalExpression } | undefined {
  if (!emotion || !Number.isSafeInteger(emotion.causeSequence) || emotion.causeSequence < 1
    || !Number.isFinite(emotion.intensity) || emotion.intensity < .05 || emotion.intensity > 1
    || !['contact', 'completed', 'user_interrupted', 'environment_lost', 'timeout'].includes(emotion.cause)) return undefined;
  const cause = emotion.cause;
  if (cause === 'other' || cause === 'unknown') return undefined;
  return { sourceSequence: emotion.causeSequence, expression: {
    intent: emotion.kind === 'irritated' && emotion.intensity >= .2 ? 'give_space' : 'acknowledge',
    emotion: emotion.kind, intensity: emotion.intensity >= .2 ? 'moderate' : 'low', target: emotion.target,
    cause, deferredInvitation, ownGameInterest,
  } };
}

/** Presentation may not displace physics, user work, critical needs or reactive runs. */
export function causalVisualExpression<TKind extends string>(intent: AnimationIntent<TKind>, expression: CausalExpression | undefined,
  gate: { readonly forced: boolean; readonly awake: boolean; readonly priority: ActivityPriorityClass | null }): AnimationIntent<TKind | 'idle_blink'> {
  if (!expression || gate.forced || !gate.awake || (gate.priority !== null && gate.priority !== 'P4_autonomous' && gate.priority !== 'P5_ambient')
    || intent.priority === 'high' || intent.priority === 'critical') return intent;
  const idleBody = gate.priority === null && (intent.category === 'reaction' || intent.category === 'dialogue');
  return { ...intent, ...(idleBody ? { kind: 'idle_blink' as const, category: 'idle' as const } : {}),
    emotionalTone: expression.emotion === 'curious' ? 'curious' : 'neutral',
    expressionHint: expression.emotion === 'irritated' ? 'pout' : expression.emotion === 'content' ? 'happy' : 'curious',
    propHint: 'none' };
}
