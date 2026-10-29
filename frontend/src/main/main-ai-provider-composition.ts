import type { IObservationProvider } from '../application/ports/observation-provider.interface';
import type { ISummaryGenerator } from '../application/ports/summary';
import type { IAIEventProvider } from '../application/ports/ai-event-provider.interface';
import type { IAIProvider } from '../application/ports/ai-provider.interface';
import { ExternalAIProviderClient } from '../infrastructure/ai/external-ai-provider-client';
import { MockAIProvider } from '../infrastructure/ai/mock-ai-provider';

/** Main-only configuration; never part of IPC or Renderer state. */
export function createMainAIProvider(options: {
  readonly backendUrl: string | undefined;
  readonly sessionToken?: string;
  readonly eventsEnabled?: boolean;
  readonly summaryEnabled?: boolean;
  readonly development: boolean;
  readonly now: () => number;
}): { readonly interactionEnabled: boolean; readonly provider: IAIProvider; readonly observationProvider?: IObservationProvider; readonly touchProvider?: IAIEventProvider; readonly eventProvider?: IAIEventProvider; readonly summaryGenerator?: ISummaryGenerator } {
  if (!options.backendUrl?.trim()) return { interactionEnabled: false, provider: new MockAIProvider({ simulatedLatencyMs: 300 }) };
  try {
    const provider = new ExternalAIProviderClient({ baseUrl: options.backendUrl, sessionToken: options.sessionToken, development: options.development, now: options.now });
    return { interactionEnabled: true, provider, observationProvider: provider, touchProvider: provider, ...(options.eventsEnabled ? { eventProvider: provider } : {}), ...(options.summaryEnabled ? { summaryGenerator: provider } : {}) };
  } catch {
    // Invalid deployment configuration must not stop local character startup.
    return { interactionEnabled: false, provider: { getStatus: async () => ({ kind: 'offline' }), generateResponse: async () => { throw new Error('Backend unavailable'); } } };
  }
}
