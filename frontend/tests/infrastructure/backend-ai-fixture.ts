import type { BackendCharacterContext } from '../../src/application/ports/backend-ai-contract';
import type { CharacterSnapshot } from '../../src/domain/character/types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AIProviderRequest } from '../../src/application/ports/ai-provider.interface';
import type { BackendInteractionChatRequest } from '../../src/application/ports/backend-interaction-contract';

export function fixture(name: string): unknown { return JSON.parse(readFileSync(join(process.cwd(), '../docs/contracts/fixtures/desktop-backend-v1', name), 'utf8')) as unknown; }
export const wire = fixture('request.valid.json') as BackendInteractionChatRequest;
/** Synthetic local state keeps an explicit local tone; wire data does not determine it. */
export function localCharacterFixture(character: BackendCharacterContext): CharacterSnapshot {
  const { expression: _permission, ...facts } = structuredClone(character);
  return { ...facts, synthesizedTone: 'neutral' };
}
export function providerRequest(): AIProviderRequest {
  return { requestId: wire.requestId, userMessage: { id: 'local-only', text: wire.messages[0]!.content, createdAt: 'local-only' },
    interaction: { card: wire.card, effectPolicy: wire.effectPolicy }, memoryContext: wire.memory, characterSnapshot: localCharacterFixture(wire.character), recentContext: [], locale: 'ru' };
}
