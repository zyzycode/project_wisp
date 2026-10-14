/** Request deadlines and retry policy; no local request quotas. */
export interface AIRequestPolicy {
  readonly version: 'desktop-ai-v1';
  readonly deadlineMs: number;
  readonly transportTimeoutMs: number;
  readonly automaticRetries: 0;
}

export const DEFAULT_AI_REQUEST_POLICY: AIRequestPolicy = {
  version: 'desktop-ai-v1',
  deadlineMs: 15_000,
  transportTimeoutMs: 12_000,
  automaticRetries: 0,
};
