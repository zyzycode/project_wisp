import type { AIProviderCharacterSnapshot } from './ai-provider.interface';
export interface ObservationProviderRequest {
  readonly requestId: string;
  readonly locale: 'ru' | 'en';
  readonly characterSnapshot: AIProviderCharacterSnapshot;
  readonly observation: { readonly appName: string; readonly windowTitle: string };
}
export interface IObservationProvider {
  /** Synchronous shared transport admission; no probe or network operation. */
  canStartObservation(): boolean;
  generateObservation(request: ObservationProviderRequest, signal: AbortSignal): Promise<string>;
}
