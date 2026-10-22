/** Standalone desktop/backend v1 wire DTOs: no imports or Domain aliases.
 * Numeric ranges are inclusive; runtime validation belongs to both boundaries.
 */
export type BackendAIBehavior =
  | 'respond' | 'think' | 'react_happy' | 'react_confused' | 'play'
  | 'sleep' | 'wake' | 'wander' | 'idle' | 'quiet';

export type BackendAITone =
  | 'warm' | 'playful' | 'sleepy' | 'curious' | 'confused' | 'quiet' | 'shy' | 'affectionate';

export type BackendAIMood =
  | 'neutral' | 'happy' | 'playful' | 'sleepy' | 'confused' | 'shy' | 'affectionate';

export type BackendCharacterTone =
  | 'shy' | 'sleepy' | 'playful' | 'curious' | 'neutral' | 'affectionate' | 'flustered';

export interface BackendAIMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface BackendCharacterExpression {
  readonly pace: 'gentle' | 'normal';
  readonly trust: 'guarded' | 'familiar' | 'close';
  readonly attention: 'high' | 'ordinary';
  readonly play: 'high' | 'ordinary';
  readonly romanceAllowed: boolean;
}

/** Wire fields are defined independently of the local character model. */
export interface BackendCharacterContext {
  /** Each value is finite and in [0, 100]. */
  readonly needs: {
    readonly energy: number;
    readonly attention: number;
    readonly play: number;
    readonly comfort: number;
    readonly boredom?: number;
  };
  readonly relationship: {
    /** Finite, [0, 1000]. */
    readonly friendship: number;
    /** Finite, [0, 1000]. */
    readonly love: number;
    readonly loveUnlocked: boolean;
  };
  readonly personality: {
    readonly presetId: string;
    readonly aiSelfConcept: string;
    /** All four values are finite and in [0, 1]. */
    readonly traits: {
      readonly shyness: number;
      readonly playfulness: number;
      readonly sensitivity: number;
      readonly boldness: number;
    };
  };
  readonly intimacy: {
    /** Finite, [0, 100]. */
    readonly flirtiness: number;
    /** Finite, [0, 100]. */
    readonly romanticCharge: number;
    readonly userConsentEnabled: boolean;
  };
  readonly synthesizedTone: BackendCharacterTone;
  readonly expression: BackendCharacterExpression;
}

export interface BackendAIRequest {
  readonly requestId: string;
  readonly event: { readonly type: 'user_message' };
  readonly messages: readonly BackendAIMessage[];
  readonly stream: false;
  readonly locale: 'ru' | 'en';
  readonly character: BackendCharacterContext;
}

export interface BackendAIDecision {
  readonly behavior: BackendAIBehavior;
  readonly tone?: BackendAITone;
  readonly mood?: BackendAIMood;
  /** Finite, [0, 1]; does not grant authority to execute the behavior. */
  readonly confidence: number;
}

export interface BackendAIResponse {
  readonly requestId: string;
  readonly text: string;
  readonly decision?: BackendAIDecision;
}

export type BackendAIErrorCode =
  | 'invalid_request'
  | 'payload_too_large'
  | 'request_conflict'
  | 'request_in_progress'
  | 'rate_limited'
  | 'budget_exhausted'
  | 'upstream_unavailable'
  | 'upstream_timeout'
  | 'invalid_model_response';

export interface BackendAIErrorResponse {
  readonly requestId: string | null;
  readonly error: {
    readonly code: BackendAIErrorCode;
    readonly retryAfterMs?: number;
  };
}
