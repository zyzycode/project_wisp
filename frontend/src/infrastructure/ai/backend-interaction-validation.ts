import type { AIProviderRequest } from '../../application/ports/ai-provider.interface';
import type { AIEventProviderRequest } from '../../application/ports/ai-event-provider.interface';
import type { BackendDialogueTopic, BackendInteractionAppraisal, BackendInteractionPolicy, BackendInteractionChatRequest, BackendInteractionTouchRequest, BackendPreviousTouchReaction } from '../../application/ports/backend-interaction-contract';
import { exactRecord, enumValue, plainText } from '../../shared/dialogue-ipc-validation';
import { projectSummaryChat, parseSummaryChatResponse } from './backend-summary-validation';
import { projectTouchRequest } from './backend-touch-validation';

function validUnicode(value: unknown): void {
  if (typeof value === 'string' && /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\uD800-\uDFFF]/u.test(value)) throw new TypeError('Invalid interaction Unicode');
  if (value && typeof value === 'object') for (const item of Object.values(value)) validUnicode(item);
}
function text(value: unknown, max: number): string {
  validUnicode(value);
  return plainText(value, max).trim();
}
function policy(value: unknown, presetId: string, chat: boolean): BackendInteractionPolicy {
  const r = exactRecord(value, ['card', 'effectPolicy'], chat ? ['previousTouch'] : []);
  const card = exactRecord(r.card, ['id', 'revision']);
  if (card.id !== 'shyDreamGirl' || card.revision !== 1 || card.id !== presetId) throw new TypeError('Invalid interaction card');
  return { card: { id: 'shyDreamGirl', revision: 1 }, effectPolicy: enumValue(r.effectPolicy, ['eligible', 'suppressed']) };
}
export function parseInteractionAppraisal(value: unknown, touch: boolean, effectPolicy: BackendInteractionPolicy['effectPolicy']): BackendInteractionAppraisal {
  const r = exactRecord(value, ['category', 'intensity', 'confidence']);
  const result = { category: enumValue(r.category, ['supportive', 'playful', 'boundary', 'hostile', 'neutral']),
    intensity: enumValue(r.intensity, ['low', 'moderate']), confidence: enumValue(r.confidence, ['clear', 'uncertain']) };
  if (touch && (result.category === 'hostile' || result.intensity !== 'low')) throw new TypeError('Invalid touch appraisal');
  if (effectPolicy === 'suppressed' && (result.category !== 'neutral' || result.intensity !== 'low' || result.confidence !== 'clear')) throw new TypeError('Suppressed interaction appraisal');
  return result;
}
export function parsePreviousTouch(value: unknown): BackendPreviousTouchReaction {
  const r = exactRecord(value, ['action', 'occurredAt', 'publishedText', 'appraisal', 'effect', 'reason', 'energyBand', 'comfortBand']);
  if (typeof r.occurredAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(r.occurredAt)
      || !Number.isFinite(Date.parse(r.occurredAt)) || new Date(r.occurredAt).toISOString() !== r.occurredAt) throw new TypeError('Invalid touch time');
  const publishedText = text(r.publishedText, 240);
  if (publishedText !== r.publishedText) throw new TypeError('Invalid touch text');
  const effect = enumValue(r.effect, ['accepted', 'neutral', 'suppressed', 'rejected']);
  const reason = enumValue(r.reason, ['applied', 'uncertain', 'cooldown', 'state_changed', 'unavailable', 'neutral']);
  const pairs: Readonly<Record<typeof effect, readonly string[]>> = { accepted: ['applied'], neutral: ['neutral', 'uncertain'], suppressed: ['cooldown'], rejected: ['state_changed', 'unavailable'] };
  if (!pairs[effect].includes(reason)) throw new TypeError('Invalid touch outcome');
  return { action: enumValue(r.action, ['touch']), occurredAt: r.occurredAt, publishedText,
    appraisal: parseInteractionAppraisal(r.appraisal, true, 'eligible'), effect, reason,
    energyBand: enumValue(r.energyBand, ['tired', 'rested']), comfortBand: enumValue(r.comfortBand, ['overloaded', 'calm']) };
}
function bytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function parseDialogueTopic(value: unknown): BackendDialogueTopic {
  const r = exactRecord(value, ['mode', 'text', 'statedAt']);
  const quote = text(r.text, 160);
  if (quote !== r.text) throw new TypeError('Invalid topic text');
  if (typeof r.statedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(r.statedAt)
      || !Number.isFinite(Date.parse(r.statedAt)) || new Date(r.statedAt).toISOString() !== r.statedAt) throw new TypeError('Invalid topic time');
  return { mode: enumValue(r.mode, ['follow_up', 'reply']), text: quote, statedAt: r.statedAt };
}
export function projectInteractionTouch(request: AIEventProviderRequest): BackendInteractionTouchRequest {
  const base = projectTouchRequest(request);
  if (base.event.variant !== 'touch') throw new TypeError('Invalid factual touch');
  const result: BackendInteractionTouchRequest = { ...base, event: { type: 'user_touch', variant: 'touch' }, ...policy(request.interaction, base.character.personality.presetId, false) };
  validUnicode(result);
  if (bytes(result) > 32768) throw new TypeError('Request too large');
  return result;
}
export function projectInteractionChat(request: AIProviderRequest): BackendInteractionChatRequest {
  const base = projectSummaryChat(request);
  const interaction = policy(request.interaction, base.character.personality.presetId, true);
  const previousTouch = request.interaction?.previousTouch === undefined ? undefined : parsePreviousTouch(request.interaction.previousTouch);
  let result: BackendInteractionChatRequest = { ...base, ...interaction, ...(previousTouch === undefined ? {} : { previousTouch }) };
  validUnicode(result);
  // Interaction context is required. Drop summary atomically, then optional episodes.
  if (bytes(result) > 32768 && result.summary !== undefined) { const { summary: _summary, ...withoutSummary } = result; result = withoutSummary; }
  while (bytes(result) > 32768 && result.memory.episodes.length) result = { ...result, memory: { ...result.memory, episodes: result.memory.episodes.slice(0, -1) } };
  if (bytes(result) > 32768) throw new TypeError('Request too large');
  // Preserve the established baseline. A topic never evicts any existing context.
  if (request.dialogueTopic !== undefined) {
    const withTopic = { ...result, dialogueTopic: parseDialogueTopic(request.dialogueTopic) };
    if (bytes(withTopic) <= 32768) return withTopic;
  }
  return result;
}
export function parseInteractionTouchResponse(value: unknown, requestId: string, effectPolicy: BackendInteractionPolicy['effectPolicy']) {
  const r = exactRecord(value, ['requestId', 'text', 'appraisal']);
  if (r.requestId !== requestId) throw new TypeError('Invalid interaction envelope');
  return { requestId, replyText: text(r.text, 240), appraisal: parseInteractionAppraisal(r.appraisal, true, effectPolicy) };
}
export function parseInteractionChatResponse(value: unknown, requestId: string, userText: string, effectPolicy: BackendInteractionPolicy['effectPolicy']) {
  const r = exactRecord(value, ['requestId', 'text', 'appraisal'], ['decision', 'memoryCandidates']);
  const appraisal = parseInteractionAppraisal(r.appraisal, false, effectPolicy);
  const { appraisal: _appraisal, ...base } = r;
  return { ...parseSummaryChatResponse({ ...base, text: text(r.text, 2000) }, requestId, userText), appraisal };
}
export { parseBackendError as parseInteractionError } from './backend-response-validation';
