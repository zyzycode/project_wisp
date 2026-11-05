/** Target #131: local session consent, never API credentials or provider settings. */
export type InitiativeBlockReason = 'none' | 'provider_unavailable' | 'memory_unavailable'
  | 'quiet' | 'away' | 'sleeping' | 'busy' | 'disabled';
export interface InitiativeControlStatusDTO {
  /** Main-owned epoch; changes before full reset/profile replacement, not a Brain stream ID. */
  readonly profileGeneration: number;
  readonly enabled: boolean;
  readonly capability: 'ready' | 'unavailable';
  readonly phase: 'off' | 'waiting' | 'generating' | 'visible';
  readonly blockReason: InitiativeBlockReason;
  /** Actual autonomous event HTTP dispatches in this process session, not a bill. */
  readonly requestsSent: number;
  readonly lastFailure: 'none' | 'unavailable' | 'auth' | 'timeout' | 'invalid_response';
}
export interface InitiativeControlCommandDTO { readonly streamId: string }
export interface InitiativeConsentCommandDTO extends InitiativeControlCommandDTO {
  readonly profileGeneration: number;
  readonly enabled: boolean;
}
export type InitiativeControlResultDTO =
  | { readonly ok: true; readonly status: InitiativeControlStatusDTO }
  | { readonly ok: false; readonly code: 'invalid_input' | 'stale' | 'unavailable' };
/** Target Main/Application seam; IPC activation and Renderer bridge arrive together. */
export interface IInitiativeControls {
  read(command: InitiativeControlCommandDTO): Promise<InitiativeControlResultDTO>;
  setConsent(command: InitiativeConsentCommandDTO): Promise<InitiativeControlResultDTO>;
}
