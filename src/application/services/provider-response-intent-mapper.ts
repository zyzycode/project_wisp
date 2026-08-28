import type { AIProviderResponse } from '../ports/ai-provider.interface';
import type {
  BehaviorIntent,
  BehaviorIntentKind,
  BehaviorIntentMoodHint,
} from '../../domain/behavior/behavior-intent';

/**
 * Maps raw AIProviderResponse DTO to internal domain BehaviorIntent.
 * Implements architectural boundaries specified in docs/engine/AI_PROVIDER_CONTRACT.md
 * and docs/engine/BEHAVIOR_INTENTS.md.
 */
export function mapProviderResponseToBehaviorIntent(
  response: AIProviderResponse
): BehaviorIntent {
  if (response.status === 'fallback') {
    return {
      kind: 'react_confused',
      source: 'provider',
      priority: 'normal',
      replyText: response.reply.text,
      moodHint: (response.suggestedMood as BehaviorIntentMoodHint) ?? 'confused',
      reason: response.diagnostics?.fallbackReason ?? 'fallback',
      requestId: response.requestId,
    };
  }

  // Provider cannot directly trigger user gestures (drag / land)
  const rawBehavior = response.suggestedBehavior as string | undefined;
  const safeKind: BehaviorIntentKind =
    rawBehavior && rawBehavior !== 'drag' && rawBehavior !== 'land'
      ? (rawBehavior as BehaviorIntentKind)
      : 'respond';

  return {
    kind: safeKind,
    source: 'provider',
    priority: 'normal',
    replyText: response.reply.text,
    moodHint: (response.suggestedMood as BehaviorIntentMoodHint) ?? 'neutral',
    requestId: response.requestId,
  };
}
