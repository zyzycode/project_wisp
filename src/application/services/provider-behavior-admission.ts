import type { BehaviorIntent } from '../../domain/behavior/behavior-intent';
import type { ActivityResult } from '../../domain/behavior/activity-runner';
import type { BehaviorAdmissionReceipt, BehaviorAdmissionRejection, BehaviorTurnContext,
  OwnedActivityRun, ProviderBehaviorOffer, IBehaviorAdmission } from '../ports/behavior-admission-port';
export interface ProviderAdmissionOptions {
  readonly now: () => number;
  readonly gate: (intent: BehaviorIntent) => BehaviorAdmissionRejection | null;
  readonly safeToStart: () => boolean;
  readonly canDefer: () => boolean;
  readonly start: (intent: BehaviorIntent) => { readonly runId: string; readonly startedAtMs: number } | null;
  readonly cancel: () => void;
}
interface Pending { readonly offer: ProviderBehaviorOffer; readonly id: string; readonly startBefore: number; }
export interface AdmissionTrace { readonly stage: string; readonly atMs: number; readonly reason?: string; readonly source: 'provider'; }
/** Arbitration state attached to the existing executor; no timer and no second runner. */
export class ProviderBehaviorAdmission implements IBehaviorAdmission {
  private context: BehaviorTurnContext | null = null;
  private consumed = false;
  private pending: Pending | null = null;
  private owned: OwnedActivityRun | null = null;
  private sequence = 0;
  private readonly trace: AdmissionTrace[] = [];
  public constructor(private readonly options: ProviderAdmissionOptions) {}
  public setContext(context: BehaviorTurnContext | null): void {
    if (context === null || (this.context && (context.generation !== this.context.generation || context.conversationId !== this.context.conversationId))) this.invalidate('reset');
    this.context = context;
    this.consumed = false;
  }
  public getOwnedRun(): OwnedActivityRun | null { return this.owned ? { ...this.owned, ownership: { ...this.owned.ownership } } : null; }
  public hasPending(): boolean { return this.pending !== null; }
  public getTrace(): readonly AdmissionTrace[] { return this.trace.map(row => ({ ...row })); }
  public offer(offer: ProviderBehaviorOffer): BehaviorAdmissionReceipt {
    this.record('received');
    const now = this.options.now();
    const ids = [offer.intent.requestId, offer.conversationId];
    if (ids.some(id => typeof id !== 'string' || !id.trim() || id.trim() !== id || id.length > 128)
        || offer.intent.source !== 'provider' || !Number.isSafeInteger(offer.generation) || offer.generation < 0
        || ![offer.requestedAtMs, offer.receivedAtMs, offer.expiresAtMs, now].every(Number.isFinite)
        || offer.requestedAtMs < 0 || offer.requestedAtMs > offer.receivedAtMs || offer.receivedAtMs > now
        || offer.expiresAtMs !== offer.requestedAtMs + 30000) return this.reject('invalid_offer');
    const context = this.context;
    if (!context || context.requestId !== offer.intent.requestId || context.conversationId !== offer.conversationId
        || context.generation !== offer.generation || context.requestedAtMs !== offer.requestedAtMs) return this.reject('stale_generation');
    if (this.consumed) return this.reject('duplicate');
    this.consumed = true;
    if (now >= offer.expiresAtMs) return this.reject('expired');
    if (this.owned || this.pending) return this.reject('active_provider');
    const rejection = this.options.gate(offer.intent);
    if (rejection) return this.reject(rejection);
    const id = `admission-${++this.sequence}`;
    if (!this.options.safeToStart()) {
      if (!this.options.canDefer()) return this.reject('forced_motion');
      const startBefore = Math.min(offer.expiresAtMs, now + 3000);
      this.pending = { offer, id, startBefore };
      this.record('admitted', 'safe_deferred');
      return { status: 'admitted', admissionId: id, mode: 'safe_deferred', startBeforeMs: startBefore };
    }
    this.record('admitted', 'immediate');
    return this.start({ offer, id, startBefore: offer.expiresAtMs })
      ? { status: 'admitted', admissionId: id, mode: 'immediate' } : this.reject('no_activity');
  }
  public tick(): void {
    const now = this.options.now();
    if (this.owned && now >= this.owned.executionEndsAtMs) { this.record('expired'); this.options.cancel(); this.owned = null; }
    const pending = this.pending;
    if (!pending) return;
    if (now >= pending.startBefore) { this.pending = null; this.record('not_started', now >= pending.offer.expiresAtMs ? 'expired' : 'defer_timeout'); return; }
    const rejection = this.options.gate(pending.offer.intent);
    if (rejection) { this.pending = null; this.record('not_started', rejection); return; }
    if (this.options.safeToStart()) { this.pending = null; this.start(pending); }
  }
  public terminated(result: ActivityResult): void {
    if (!this.owned) return;
    this.record(result.status);
    this.owned = null;
  }
  public invalidate(reason: string): void {
    if (this.pending) { this.pending = null; this.record('not_started', reason); }
    if (this.owned) { this.record('cancelled', reason); this.owned = null; this.options.cancel(); }
    this.consumed = true;
  }
  private start(pending: Pending): boolean {
    const runtime = this.options.start(pending.offer.intent);
    if (!runtime) { this.record('not_started', 'no_activity'); return false; }
    this.owned = { ...runtime, executionEndsAtMs: Math.min(pending.offer.expiresAtMs, runtime.startedAtMs + 20000),
      ownership: { source: 'provider', rank: 'P3_reactive', admissionId: pending.id,
        requestId: pending.offer.intent.requestId, conversationId: pending.offer.conversationId,
        generation: pending.offer.generation, expiresAtMs: pending.offer.expiresAtMs } };
    this.record('started');
    return true;
  }
  private reject(reason: BehaviorAdmissionRejection): BehaviorAdmissionReceipt { this.record('rejected', reason); return { status: 'rejected', reason }; }
  private record(stage: string, reason?: string): void {
    this.trace.push({ stage, reason, atMs: this.options.now(), source: 'provider' });
    if (this.trace.length > 64) this.trace.shift();
  }
}
