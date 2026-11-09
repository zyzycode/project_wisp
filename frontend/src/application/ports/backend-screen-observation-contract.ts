/** SCREEN-A01 target wire only; #193 activates both sides and fixtures together. */
export interface BackendScreenImage {
  readonly mimeType: 'image/jpeg';
  readonly width: number;
  readonly height: number;
  readonly dataBase64: string;
}

export interface BackendScreenObservationRequest {
  readonly requestId: string;
  readonly stream: false;
  readonly locale: 'ru' | 'en';
  readonly policyRevision: 'screen-openai-2026-11';
  readonly image: BackendScreenImage;
}

export interface ScreenObservationEvidence {
  readonly visible: readonly string[];
  readonly possible: readonly string[];
  readonly unknown: readonly string[];
}

export interface BackendScreenObservationResponse {
  readonly requestId: string;
  readonly observation: ScreenObservationEvidence;
}

/** Authenticated server capability, not inferred from metadata-observation/chat readiness. */
export type BackendScreenObservationCapability =
  | { readonly status: 'available'; readonly provider: 'openai'; readonly model: 'gpt-6-astra';
      readonly policyRevision: 'screen-openai-2026-11' }
  | { readonly status: 'unavailable'; readonly reason: 'unsupported_profile' | 'policy_unconfirmed' };
