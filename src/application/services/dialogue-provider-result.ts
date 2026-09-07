import type { AIProviderResponse, AIProviderStatus } from '../ports/ai-provider.interface';
import type { DialogueFallbackReasonDTO } from '../../shared/ipc-contracts';
import { exactRecord, enumValue, plainText } from '../../shared/dialogue-ipc-validation';

export function parseProviderStatus(value: unknown): AIProviderStatus {
  const r = exactRecord(value, ['kind'], ['activeRequestId', 'message']);
  if (r.activeRequestId !== undefined) plainText(r.activeRequestId, 128);
  if (r.message !== undefined) plainText(r.message, 2000);
  return { kind: enumValue(r.kind, ['ready', 'thinking', 'degraded', 'offline', 'error']) };
}
export function parseProviderResponse(value: unknown, requestId: string): AIProviderResponse {
  const r = exactRecord(value, ['requestId', 'status', 'reply', 'confidence'], ['suggestedMood', 'suggestedBehavior', 'diagnostics']);
  if (r.requestId !== requestId || typeof r.confidence !== 'number' || !Number.isFinite(r.confidence) || r.confidence < 0 || r.confidence > 1) throw new TypeError('Invalid provider response');
  const reply = exactRecord(r.reply, ['text'], ['tone']);
  if (typeof reply.text !== 'string') throw new TypeError('Invalid reply');
  const response: AIProviderResponse = { requestId, status: enumValue(r.status, ['ok', 'fallback']), confidence: r.confidence,
    reply: { text: plainText(reply.text.trim().slice(0, 2000), 2000),
      ...(reply.tone === undefined ? {} : { tone: enumValue(reply.tone, ['warm', 'playful', 'sleepy', 'curious', 'confused', 'quiet', 'shy', 'affectionate']) }) },
    ...(r.suggestedMood === undefined ? {} : { suggestedMood: enumValue(r.suggestedMood, ['neutral', 'happy', 'curious', 'sleepy', 'confused', 'shy', 'affectionate']) }),
    ...(r.suggestedBehavior === undefined ? {} : { suggestedBehavior: enumValue(r.suggestedBehavior, ['respond', 'think', 'react_happy', 'react_confused', 'play', 'sleep', 'wake', 'wander', 'idle', 'quiet']) }) };
  if (r.diagnostics !== undefined) {
    const d = exactRecord(r.diagnostics, ['provider', 'latencyMs'], ['fallbackReason']);
    if (typeof d.latencyMs !== 'number' || !Number.isFinite(d.latencyMs) || d.latencyMs < 0) throw new TypeError('Invalid diagnostics');
    response.diagnostics = { provider: enumValue(d.provider, ['mock', 'external']), latencyMs: d.latencyMs,
      ...(d.fallbackReason === undefined ? {} : { fallbackReason: enumValue(d.fallbackReason, ['empty_input', 'message_too_long', 'unsupported_input', 'provider_unavailable', 'timeout', 'unexpected_error']) }) };
  }
  return response;
}
export function fallbackReason(response: AIProviderResponse): DialogueFallbackReasonDTO {
  switch (response.diagnostics?.fallbackReason) {
    case 'provider_unavailable': return 'offline';
    case 'timeout': return 'timeout';
    case 'unexpected_error': return 'provider_error';
    default: return 'degraded';
  }
}
export const DIALOGUE_FALLBACK = 'Сейчас мне трудно подобрать ответ, но я рядом.';
