import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AIProviderRequest } from '../../src/application/ports/ai-provider.interface';
import type { BackendAIRequest } from '../../src/application/ports/backend-ai-contract';

export function fixture(name: string): unknown { return JSON.parse(readFileSync(join(process.cwd(), 'docs/contracts/fixtures/desktop-backend-v1', name), 'utf8')) as unknown; }
export const wire = fixture('request.valid.json') as BackendAIRequest;
export function providerRequest(): AIProviderRequest {
  return { requestId: wire.requestId, userMessage: { id: 'local-only', text: wire.messages[0]!.content, createdAt: 'local-only' },
    characterSnapshot: structuredClone(wire.character), recentContext: [], locale: 'ru' };
}
