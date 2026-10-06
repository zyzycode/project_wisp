import type { AIProviderRequest } from '../../application/ports/ai-provider.interface';
import type { BackendAIRequest, BackendCharacterContext } from '../../application/ports/backend-ai-contract';
import { enumValue, plainText } from '../../shared/dialogue-ipc-validation';

export function finiteRange(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new TypeError('Invalid backend range');
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError('Invalid backend boolean');
  return value;
}
export function backendRequestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new TypeError('Invalid backend request ID');
  return value;
}

export function projectBackendRequest(request: AIProviderRequest): BackendAIRequest {
  const s = request.characterSnapshot;
  // Copy only allowed primitives. Arbitrary local Needs keys never cross the wire.
  const character: BackendCharacterContext = {
    needs: { energy: finiteRange(s.needs.energy, 100), attention: finiteRange(s.needs.attention, 100),
      play: finiteRange(s.needs.play, 100), comfort: finiteRange(s.needs.comfort, 100),
      ...(s.needs.boredom === undefined ? {} : { boredom: finiteRange(s.needs.boredom, 100) }) },
    relationship: { friendship: finiteRange(s.relationship.friendship, 1000), love: finiteRange(s.relationship.love, 1000), loveUnlocked: boolean(s.relationship.loveUnlocked) },
    personality: { presetId: plainText(s.personality.presetId, 128, true), aiSelfConcept: plainText(s.personality.aiSelfConcept.slice(0, 500), 500, true),
      traits: { shyness: finiteRange(s.personality.traits.shyness, 1), playfulness: finiteRange(s.personality.traits.playfulness, 1),
        sensitivity: finiteRange(s.personality.traits.sensitivity, 1), boldness: finiteRange(s.personality.traits.boldness, 1) } },
    intimacy: { flirtiness: finiteRange(s.intimacy.flirtiness, 100), romanticCharge: finiteRange(s.intimacy.romanticCharge, 100), userConsentEnabled: boolean(s.intimacy.userConsentEnabled) },
    synthesizedTone: enumValue(s.synthesizedTone, ['shy', 'sleepy', 'playful', 'curious', 'neutral', 'affectionate', 'flustered']),
  };
  if (request.recentContext.length % 2 !== 0) throw new TypeError('Incomplete dialogue pair');
  const messages = request.recentContext.slice(-6).map((message, index) => {
    if (message.role !== (index % 2 === 0 ? 'user' : 'wisp')) throw new TypeError('Invalid dialogue order');
    return { role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: plainText(message.text, index % 2 === 0 ? 240 : 2000, true) };
  });
  messages.push({ role: 'user', content: plainText(request.userMessage.text, 240, true) });
  return { version: 1, requestId: backendRequestId(request.requestId), event: { type: 'user_message' }, messages,
    stream: false, locale: request.locale === 'en' ? 'en' : 'ru', character };
}
