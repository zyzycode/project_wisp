import type { IAIProvider } from '../application/ports/ai-provider.interface';
import type { IAIRequestControl } from '../application/ports/ai-request-policy';
import { AIRequestControl } from '../application/services/ai-request-control';
import { ExternalAIProviderClient } from '../infrastructure/ai/external-ai-provider-client';
import { MockAIProvider } from '../infrastructure/ai/mock-ai-provider';

/** Main-only configuration; never part of IPC or Renderer state. */
export function createMainAIProvider(options: {
  readonly backendUrl: string | undefined;
  readonly development: boolean;
  readonly now: () => number;
}): { readonly provider: IAIProvider; readonly requestControl?: IAIRequestControl } {
  if (!options.backendUrl?.trim()) return { provider: new MockAIProvider({ simulatedLatencyMs: 300 }) };
  const requestControl = new AIRequestControl();
  try {
    return { provider: new ExternalAIProviderClient({ baseUrl: options.backendUrl, development: options.development, now: options.now, requestControl }), requestControl };
  } catch {
    // Invalid deployment configuration must not stop local character startup.
    return { provider: { getStatus: async () => ({ kind: 'offline' }), generateResponse: async () => { throw new Error('Backend unavailable'); } } };
  }
}
