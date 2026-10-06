import type { IAIEventRequestControl } from '../ports/ai-event-provider.interface';
import { DEFAULT_AI_REQUEST_POLICY, type AIRequestPolicy, type AIRequestAvailability } from '../ports/ai-request-policy';

/** Local counters only; server budget and identity are outside this policy. */
export class AIRequestControl implements IAIEventRequestControl {
  private sentAt: number[] = [];
  private sentCount = 0;
  private retryAtMs = 0;
  private eventTimes: number[] = [];
  private eventCount = 0;
  private lastEventAt = -Infinity;
  constructor(private readonly policy: AIRequestPolicy = DEFAULT_AI_REQUEST_POLICY, private readonly startedAtMs = 0) {}

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

  public eventAvailability(nowMs: number): AIRequestAvailability {
    const common = this.availability(nowMs); if (!common.available) return common;
    if (this.sentCount >= this.policy.maxRequestsPerSession - 20 || this.eventCount >= 10) return { available: false, reason: 'budget_exhausted' };
    this.eventTimes = this.eventTimes.filter(time => time > nowMs - 3600000);
    const retryAtMs = Math.max(this.startedAtMs + 300000, this.lastEventAt + 300000, this.eventTimes.length >= 2 ? this.eventTimes[0]! + 3600000 : 0);
    return nowMs < retryAtMs ? { available: false, reason: 'rate_limited', retryAtMs } : { available: true };
  }
  public recordEventSubmission(nowMs: number): boolean {
    if (!this.eventAvailability(nowMs).available || !this.recordSubmission(nowMs)) return false;
    this.eventTimes.push(nowMs); this.lastEventAt = nowMs; this.eventCount++; return true;
  }
  public deferUntil(retryAtMs: number): void { this.retryAtMs = Math.max(this.retryAtMs, retryAtMs); }
}
