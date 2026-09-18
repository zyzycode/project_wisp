import type { BackendAIDecision, BackendAIErrorResponse, BackendAIResponse } from '../../application/ports/backend-ai-contract';
import { enumValue, exactRecord, plainText } from '../../shared/dialogue-ipc-validation';
import { finiteRange } from './backend-request-projection';

function parseDecision(value: unknown): BackendAIDecision | undefined {
  try {
    const d = exactRecord(value, ['behavior', 'confidence'], ['tone', 'mood']);
    return { behavior: enumValue(d.behavior, ['respond', 'think', 'react_happy', 'react_confused', 'play', 'sleep', 'wake', 'wander', 'idle', 'quiet']),
      confidence: finiteRange(d.confidence, 1),
      ...(d.tone === undefined ? {} : { tone: enumValue(d.tone, ['warm', 'playful', 'sleepy', 'curious', 'confused', 'quiet', 'shy', 'affectionate']) }),
      ...(d.mood === undefined ? {} : { mood: enumValue(d.mood, ['neutral', 'happy', 'playful', 'sleepy', 'confused', 'shy', 'affectionate']) }) };
  } catch { return undefined; }
}
export function parseBackendSuccess(value: unknown, requestId: string): BackendAIResponse {
  const r = exactRecord(value, ['version', 'requestId', 'text'], ['decision']);
  if (r.version !== 1 || r.requestId !== requestId) throw new TypeError('Invalid backend envelope');
  const decision = parseDecision(r.decision);
  return { version: 1, requestId, text: plainText(r.text, 2000, true), ...(decision === undefined ? {} : { decision }) };
}
const ERROR_STATUS = {
  invalid_request: 400, unsupported_version: 400, payload_too_large: 413,
  request_conflict: 409, request_in_progress: 409, rate_limited: 429, budget_exhausted: 429,
  upstream_unavailable: 503, upstream_timeout: 504, invalid_model_response: 502,
} as const;
export function parseBackendError(value: unknown, requestId: string, status: number): BackendAIErrorResponse {
  const r = exactRecord(value, ['version', 'requestId', 'error']);
  // This client always sends a validated UUID. A null ID cannot correlate its response.
  if (r.version !== 1 || r.requestId !== requestId) throw new TypeError('Invalid backend error envelope');
  const e = exactRecord(r.error, ['code'], ['retryAfterMs']);
  const code = enumValue(e.code, ['invalid_request', 'unsupported_version', 'payload_too_large', 'request_conflict', 'request_in_progress', 'rate_limited', 'budget_exhausted', 'upstream_unavailable', 'upstream_timeout', 'invalid_model_response']);
  if (ERROR_STATUS[code] !== status) throw new TypeError('Backend HTTP/code mismatch');
  const retry = e.retryAfterMs;
  // A malformed optional retry hint uses the mandated local cooldown for 429.
  const validRetry = typeof retry === 'number' && Number.isInteger(retry) && retry >= 1 && retry <= 86_400_000;
  if (retry !== undefined && !validRetry && status !== 429) throw new TypeError('Invalid retry hint');
  return { version: 1, requestId, error: { code, ...(validRetry ? { retryAfterMs: retry } : {}) } };
}
