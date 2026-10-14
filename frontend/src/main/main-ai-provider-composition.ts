import type { IAIEventProvider } from '../application/ports/ai-event-provider.interface';
import type { IAIProvider } from '../application/ports/ai-provider.interface';
import { ExternalAIProviderClient } from '../infrastructure/ai/external-ai-provider-client';
import { MockAIProvider } from '../infrastructure/ai/mock-ai-provider';

/** Main-only configuration; never part of IPC or Renderer state. */
export function createMainAIProvider(options: {
  readonly backendUrl: string | undefined;
  readonly backendApiVersion?: string;
  readonly eventsEnabled?: boolean;
  readonly development: boolean;
  readonly now: () => number;
}): { readonly provider: IAIProvider; readonly touchProvider?: IAIEventProvider; readonly eventProvider?: IAIEventProvider } {
  if (!options.backendUrl?.trim()) return { provider: new MockAIProvider({ simulatedLatencyMs: 300 }) };
  try {
    if (options.backendApiVersion !== undefined && !['1', '2', '3'].includes(options.backendApiVersion)) throw new TypeError('Invalid backend version');
    const provider = new ExternalAIProviderClient({ baseUrl: options.backendUrl, apiVersion: options.backendApiVersion === '3' ? 3 : options.backendApiVersion === '2' ? 2 : 1, development: options.development, now: options.now });
    return { provider, touchProvider: provider, ...(options.backendApiVersion === '3' && options.eventsEnabled ? { eventProvider: provider } : {}) };
  } catch {
    // Invalid deployment configuration must not stop local character startup.
    return { provider: { getStatus: async () => ({ kind: 'offline' }), generateResponse: async () => { throw new Error('Backend unavailable'); } } };
  }
}
