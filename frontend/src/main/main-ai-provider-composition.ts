import type { IObservationProvider } from '../application/ports/observation-provider.interface';
import type { ISummaryGenerator } from '../application/ports/summary';
import type { IAIEventProvider } from '../application/ports/ai-event-provider.interface';
import type { IAIProvider } from '../application/ports/ai-provider.interface';
import { ExternalAIProviderClient } from '../infrastructure/ai/external-ai-provider-client';
import { MockAIProvider } from '../infrastructure/ai/mock-ai-provider';

/** Main-only configuration; never part of IPC or Renderer state. */
export function createMainAIProvider(options: {
  readonly backendUrl: string | undefined;
  readonly backendApiVersion?: string;
  readonly eventsEnabled?: boolean;
  readonly summaryEnabled?: boolean;
  readonly development: boolean;
  readonly now: () => number;
}): { readonly interactionEnabled: boolean; readonly provider: IAIProvider; readonly observationProvider?: IObservationProvider; readonly touchProvider?: IAIEventProvider; readonly eventProvider?: IAIEventProvider; readonly summaryGenerator?: ISummaryGenerator } {
  if (!options.backendUrl?.trim()) return { interactionEnabled: false, provider: new MockAIProvider({ simulatedLatencyMs: 300 }) };
  try {
    if (options.backendApiVersion !== undefined && !['1', '2', '3', '5', '7'].includes(options.backendApiVersion)) throw new TypeError('Invalid backend version');
    const provider = new ExternalAIProviderClient({ baseUrl: options.backendUrl, apiVersion: options.backendApiVersion === '7' ? 7 : options.backendApiVersion === '5' ? 5 : options.backendApiVersion === '3' ? 3 : options.backendApiVersion === '2' ? 2 : 1, development: options.development, now: options.now });
    return { interactionEnabled: options.backendApiVersion === '7', provider, observationProvider: provider, touchProvider: provider, ...(['3', '5', '7'].includes(options.backendApiVersion ?? '') && options.eventsEnabled ? { eventProvider: provider } : {}), ...(['5', '7'].includes(options.backendApiVersion ?? '') && options.summaryEnabled ? { summaryGenerator: provider } : {}) };
  } catch {
    // Invalid deployment configuration must not stop local character startup.
    return { interactionEnabled: false, provider: { getStatus: async () => ({ kind: 'offline' }), generateResponse: async () => { throw new Error('Backend unavailable'); } } };
  }
}
