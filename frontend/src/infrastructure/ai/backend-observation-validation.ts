import { summaryPlainText } from '../../shared/summary-text-validation';
import type { ObservationProviderRequest } from '../../application/ports/observation-provider.interface';
import { exactRecord, enumValue, plainText } from '../../shared/dialogue-ipc-validation';
import { projectBackendRequest, backendRequestId, finiteRange, parseBackendExpression } from './backend-request-projection';
export function observationMetadata(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.length) || value.length > max || value.trim() !== value
    || /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new TypeError('Invalid observation metadata');
  return value;
}
export function projectObservationRequest(request: ObservationProviderRequest) {
  const base = projectBackendRequest({ requestId: request.requestId, characterSnapshot: request.characterSnapshot, locale: request.locale,
    recentContext: [], userMessage: { id: '', text: 'projection', createdAt: '' } });
  const observation = exactRecord(request.observation, ['appName', 'windowTitle']);
  const body = { requestId: backendRequestId(request.requestId), stream: false as const,
    locale: enumValue(request.locale, ['ru', 'en']), character: base.character,
    observation: { appName: observationMetadata(observation.appName, 80), windowTitle: observationMetadata(observation.windowTitle, 160, true) } };
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 32768) throw new TypeError('Observation request too large');
  return body;
}
export function parseObservationResponse(value: unknown, requestId: string): string {
  const body = exactRecord(value, ['requestId', 'text']);
  if (body.requestId !== backendRequestId(requestId)) throw new TypeError('Invalid observation envelope');
  const text = summaryPlainText(body.text, 240).trim();
  if (text.trim() !== text) throw new TypeError('Invalid observation text');
  return text;
}
export { parseBackendError as parseObservationError } from './backend-response-validation';

/** Exact wire guard used at the adapter boundary and by the shared corpus. */
export function parseObservationRequest(value: unknown) {
  const r = exactRecord(value, ['requestId', 'stream', 'locale', 'character', 'observation']);
  if (r.stream !== false) throw new TypeError('Invalid observation request');
  const c = exactRecord(r.character, ['needs', 'relationship', 'personality', 'intimacy', 'synthesizedTone', 'expression']);
  const expression = parseBackendExpression(c.expression);
  const needs = exactRecord(c.needs, ['energy', 'attention', 'play', 'comfort'], ['boredom']);
  const relationship = exactRecord(c.relationship, ['friendship', 'love', 'loveUnlocked']);
  const personality = exactRecord(c.personality, ['presetId', 'aiSelfConcept', 'traits']);
  const traits = exactRecord(personality.traits, ['shyness', 'playfulness', 'sensitivity', 'boldness']);
  const intimacy = exactRecord(c.intimacy, ['flirtiness', 'romanticCharge', 'userConsentEnabled']);
  const flag = (v: unknown): boolean => { if (typeof v !== 'boolean') throw new TypeError('Invalid character flag'); return v; };
  const observation = exactRecord(r.observation, ['appName', 'windowTitle']);
  const projected = projectObservationRequest({ requestId: backendRequestId(r.requestId), locale: enumValue(r.locale, ['ru', 'en']),
    characterSnapshot: {
      needs: { energy: finiteRange(needs.energy, 100), attention: finiteRange(needs.attention, 100), play: finiteRange(needs.play, 100), comfort: finiteRange(needs.comfort, 100), ...(needs.boredom === undefined ? {} : { boredom: finiteRange(needs.boredom, 100) }) },
      relationship: { friendship: finiteRange(relationship.friendship, 1000), love: finiteRange(relationship.love, 1000), loveUnlocked: flag(relationship.loveUnlocked) },
      personality: { presetId: plainText(personality.presetId, 128, true), aiSelfConcept: plainText(personality.aiSelfConcept, 500, true), traits: {
        shyness: finiteRange(traits.shyness, 1), playfulness: finiteRange(traits.playfulness, 1), sensitivity: finiteRange(traits.sensitivity, 1), boldness: finiteRange(traits.boldness, 1) } },
      intimacy: { flirtiness: finiteRange(intimacy.flirtiness, 100), romanticCharge: finiteRange(intimacy.romanticCharge, 100), userConsentEnabled: flag(intimacy.userConsentEnabled) },
      synthesizedTone: enumValue(c.synthesizedTone, ['shy', 'sleepy', 'playful', 'curious', 'neutral', 'affectionate', 'flustered']) },
    observation: { appName: observationMetadata(observation.appName, 80), windowTitle: observationMetadata(observation.windowTitle, 160, true) } });
  return { ...projected, character: { ...projected.character, expression } };
}
