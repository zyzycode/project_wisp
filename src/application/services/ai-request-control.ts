import { DEFAULT_AI_REQUEST_POLICY, type AIRequestPolicy, type AIRequestAvailability, type IAIRequestControl } from '../ports/ai-request-policy';

/** Local counters only; server budget and identity are outside this policy. */
export class AIRequestControl implements IAIRequestControl {
  private sentAt: number[] = [];
  private sentCount = 0;
  private retryAtMs = 0;
  constructor(private readonly policy: AIRequestPolicy = DEFAULT_AI_REQUEST_POLICY) {}

  public availability(nowMs: number): AIRequestAvailability {
    this.sentAt = this.sentAt.filter(time => time > nowMs - 60_000);
    if (this.sentCount >= this.policy.maxRequestsPerSession) return { available: false, reason: 'budget_exhausted' };
    const minuteRetry = this.sentAt.length >= this.policy.maxRequestsPerMinute ? this.sentAt[0]! + 60_000 : 0;
    const retryAtMs = Math.max(minuteRetry, this.retryAtMs);
    if (retryAtMs > nowMs) return { available: false, reason: minuteRetry >= this.retryAtMs ? 'rate_limited' : 'unavailable', retryAtMs };
    return { available: true };
  }

  public recordSubmission(nowMs: number): boolean {
    if (!this.availability(nowMs).available) return false;
    this.sentAt.push(nowMs); this.sentCount++;
    return true;
  }

  public deferUntil(retryAtMs: number): void { this.retryAtMs = Math.max(this.retryAtMs, retryAtMs); }
}
