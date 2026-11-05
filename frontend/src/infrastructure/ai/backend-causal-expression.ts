import type { BackendCausalExpression } from '../../application/ports/backend-ai-contract';
import { exactRecord, enumValue } from '../../shared/dialogue-ipc-validation';

export function parseBackendCausalExpression(value: unknown): BackendCausalExpression {
  const r = exactRecord(value, ['activity', 'intent', 'emotion', 'intensity', 'target', 'cause', 'deferredInvitation', 'ownActivityInterest']);
  if (typeof r.deferredInvitation !== 'boolean') throw new TypeError('Invalid causal flag');
  const result: BackendCausalExpression = {
    activity: enumValue(r.activity, ['contact', 'cursor_game', 'book']),
    intent: enumValue(r.intent, ['respond', 'acknowledge', 'give_space', 'continue_activity']),
    emotion: enumValue(r.emotion, ['content', 'curious', 'irritated']), intensity: enumValue(r.intensity, ['low', 'moderate']),
    target: enumValue(r.target, ['user', 'environment', 'self']),
    cause: enumValue(r.cause, ['contact', 'completed', 'user_interrupted', 'environment_lost', 'timeout']),
    deferredInvitation: r.deferredInvitation, ownActivityInterest: enumValue(r.ownActivityInterest, ['none', 'emerging', 'established']),
  };
  if ((result.activity === 'contact') !== (result.cause === 'contact')
    || (result.activity === 'contact' && (result.ownActivityInterest !== 'none' || result.deferredInvitation))) throw new TypeError('Invalid contact activity');
  if (result.activity === 'book') {
    const target = result.cause === 'completed' ? 'self' : result.cause === 'user_interrupted' ? 'user' : 'environment';
    if (result.deferredInvitation || result.intensity !== 'low' || result.target !== target
      || result.emotion !== (result.cause === 'completed' ? 'content' : 'irritated')) throw new TypeError('Invalid book expression');
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 512) throw new TypeError('Causal expression too large');
  return result;
}
