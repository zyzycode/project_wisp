import type { AIEventProviderRequest } from '../../application/ports/ai-event-provider.interface';
import type { BackendTouchRequest } from '../../application/ports/backend-touch-contract';
import { exactRecord, enumValue, plainText } from '../../shared/dialogue-ipc-validation';
import { projectBackendRequest } from './backend-request-projection';

export function projectTouchRequest(request: AIEventProviderRequest): BackendTouchRequest {
  const event = exactRecord(request.event, ['type', 'variant', 'occurredAt']);
  const base = projectBackendRequest({ requestId: request.requestId, characterSnapshot: request.characterSnapshot,
    locale: request.locale, recentContext: [], userMessage: { id: '', text: 'projection', createdAt: '' } });
  return { version: 1, requestId: base.requestId, stream: false, locale: base.locale, character: base.character,
    event: { type: enumValue(event.type, ['user_touch']), variant: enumValue(event.variant, ['stroke', 'touch', 'ruffle', 'poke']) } };
}

export function parseTouchResponse(value: unknown, requestId: string) {
  const response = exactRecord(value, ['version', 'requestId', 'text']);
  if (response.version !== 1 || response.requestId !== requestId) throw new TypeError('Invalid touch envelope');
  return { requestId, replyText: plainText(response.text, 240, true) };
}
