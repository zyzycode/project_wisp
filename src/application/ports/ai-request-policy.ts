/** Desktop-only admission guards, not a backend request/token budget.
 * Target policy supplied to Application. No clock, network or storage here.
 */
export interface AIRequestPolicy {
  readonly version: 'desktop-ai-v1';
  readonly maxInFlight: 1;
  readonly maxRequestsPerMinute: number;
  readonly maxRequestsPerSession: number;
  readonly deadlineMs: number;
  readonly transportTimeoutMs: number;
  readonly automaticRetries: 0;
}

export const DEFAULT_AI_REQUEST_POLICY: AIRequestPolicy = {
  version: 'desktop-ai-v1',
  maxInFlight: 1,
  maxRequestsPerMinute: 6,
  maxRequestsPerSession: 100,
  deadlineMs: 15_000,
  transportTimeoutMs: 12_000,
  automaticRetries: 0,
};

export type AIRequestBlockReason = 'busy' | 'rate_limited' | 'budget_exhausted' | 'unavailable';

export type AIRequestAdmission =
  | { readonly accepted: true; readonly requestId: string }
  | { readonly accepted: false; readonly reason: AIRequestBlockReason };
