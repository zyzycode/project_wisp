import type { BackendCausalExpression } from '../../application/ports/backend-ai-contract';
import { exactRecord, enumValue } from '../../shared/dialogue-ipc-validation';

export function parseBackendCausalExpression(value: unknown): BackendCausalExpression {
  const r = exactRecord(value, ['intent', 'emotion', 'intensity', 'target', 'cause', 'deferredInvitation', 'ownGameInterest']);
  if (typeof r.deferredInvitation !== 'boolean') throw new TypeError('Invalid causal flag');
  const result: BackendCausalExpression = {
    intent: enumValue(r.intent, ['respond', 'acknowledge', 'give_space', 'continue_activity']),
    emotion: enumValue(r.emotion, ['content', 'curious', 'irritated']), intensity: enumValue(r.intensity, ['low', 'moderate']),
    target: enumValue(r.target, ['user', 'environment', 'self']),
    cause: enumValue(r.cause, ['contact', 'completed', 'user_interrupted', 'environment_lost', 'timeout']),
    deferredInvitation: r.deferredInvitation, ownGameInterest: enumValue(r.ownGameInterest, ['none', 'emerging', 'established']),
  };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 512) throw new TypeError('Causal expression too large');
  return result;
}
