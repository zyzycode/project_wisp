import type { VerifiedWindowHelpTarget, WindowHelpChoice, WindowHelpOutcome,
  WindowHelpStatusDTO } from '../ports/window-help.interface';

interface ActiveHelp {
  readonly choice: WindowHelpChoice;
  readonly requestId: string;
  readonly startedAtMs: number;
  phase: 'preparing' | 'waiting' | 'assisting';
  expiresAtMs: number;
  dispatched: boolean;
}
export interface WindowHelpEligibility {
  readonly allowed: boolean;
  readonly noCausalOverride: boolean;
  readonly boredom: number;
  readonly energy: number;
}
export interface WindowHelpSessionOptions {
  readonly cancelGeneration: () => void;
  readonly clearSpeech: () => void;
  readonly closed: (requestId: string, outcome: WindowHelpOutcome) => void;
}
const NONE: WindowHelpStatusDTO = { phase: 'none' };

/** One volatile resolved-choice attempt; no Activity, episode, reward or queued retry. */
export class WindowHelpSession {
  private active: ActiveHelp | null = null;
  private closedStatus: WindowHelpStatusDTO = NONE;
  private closedUntilMs = 0;
  private highWaterSequence = -1;
  private armed = true;
  private nextDispatchAtMs = 0;
  public constructor(private readonly options: WindowHelpSessionOptions) {}

  public observeBoredom(boredom: number, nowMs: number): void {
    if (Number.isFinite(boredom) && boredom < 40) {
      this.armed = true;
      if (this.active) this.close('cancelled', nowMs);
    }
  }
  public eligible(nowMs: number, eligibility: WindowHelpEligibility): boolean {
    return this.active === null && this.armed && nowMs >= this.nextDispatchAtMs
      && eligibility.allowed && eligibility.noCausalOverride
      && [eligibility.boredom, eligibility.energy].every(value => Number.isFinite(value) && value >= 0 && value <= 100)
      && eligibility.boredom >= 60 && eligibility.energy >= 30;
  }
  public prepare(choice: WindowHelpChoice, requestId: string, nowMs: number,
    eligibility: WindowHelpEligibility): boolean {
    if (!this.eligible(nowMs, eligibility) || choice.decisionSequence <= this.highWaterSequence
      || choice.reason !== 'resolved_explore_needs_manual_support'
      || !Number.isSafeInteger(choice.decisionSequence) || !Number.isSafeInteger(choice.generation)
      || !requestId || nowMs < choice.selectedAtMs || nowMs - choice.selectedAtMs > 300
      || !this.fresh(choice.target, nowMs)) return false;
    this.highWaterSequence = choice.decisionSequence;
    this.armed = false;
    this.closedStatus = NONE;
    this.active = { choice, requestId, startedAtMs: nowMs, phase: 'preparing', expiresAtMs: nowMs + 3500, dispatched: false };
    return true;
  }
  /** Exactly once, adjacent to the shared InitiativeBudget.start and actual HTTP dispatch. */
  public dispatched(requestId: string, nowMs: number): boolean {
    if (!this.active || this.active.requestId !== requestId || this.active.phase !== 'preparing'
      || this.active.dispatched || nowMs >= this.active.expiresAtMs) return false;
    this.active.dispatched = true;
    this.nextDispatchAtMs = nowMs + 20 * 60 * 1000;
    return true;
  }
  public published(requestId: string, nowMs: number): boolean {
    if (!this.active || this.active.requestId !== requestId || this.active.phase !== 'preparing'
      || !this.active.dispatched || nowMs >= this.active.expiresAtMs) return false;
    this.active.phase = 'waiting';
    this.active.expiresAtMs = nowMs + 60000;
    return true;
  }
  public generationFailed(requestId: string, nowMs: number): void {
    if (this.active?.requestId === requestId && this.active.phase === 'preparing') this.close('cancelled', nowMs);
  }
  public refresh(target: VerifiedWindowHelpTarget | null, nowMs: number): boolean {
    if (!this.active) return false;
    if (!target || !this.fresh(target, nowMs) || !this.sameTarget(this.active.choice.target, target)) {
      this.close('target_lost', nowMs);
      return false;
    }
    return true;
  }
  /** Main calls only after authoritative acceptance of the user's drag. */
  public beginAcceptedDrag(nowMs: number): boolean {
    this.tick(nowMs);
    if (!this.active) return false;
    if (this.active.phase !== 'waiting') { this.close('cancelled', nowMs); return false; }
    this.active.phase = 'assisting';
    this.active.expiresAtMs = Math.min(this.active.expiresAtMs, nowMs + 10000);
    this.options.clearSpeech();
    return true;
  }
  /** Main supplies the fresh attachment produced by the accepted release, never cursor intent. */
  public acceptedRelease(target: VerifiedWindowHelpTarget | null, nowMs: number): void {
    this.tick(nowMs);
    if (!this.active || this.active.phase !== 'assisting') return;
    this.close(target && this.fresh(target, nowMs) && this.sameTarget(this.active.choice.target, target)
      ? 'fulfilled' : 'cancelled', nowMs);
  }
  public decline(requestId: string, nowMs: number): boolean {
    this.tick(nowMs);
    if (!this.active || this.active.phase === 'preparing' || this.active.requestId !== requestId) return false;
    this.close('declined', nowMs);
    return true;
  }
  public cancel(nowMs: number): void { if (this.active) this.close('cancelled', nowMs); }
  /** P0 accepted assist drag alone preserves the published goal; all other owners cancel. */
  public forcedOwner(nowMs: number, acceptedAssistDrag: boolean): void {
    if (!(acceptedAssistDrag && this.active?.phase === 'assisting')) this.cancel(nowMs);
  }
  public tick(nowMs: number): void {
    if (this.active && nowMs >= this.active.expiresAtMs) {
      this.close(this.active.phase === 'waiting' ? 'unanswered' : 'cancelled', nowMs);
    }
    if (!this.active && nowMs >= this.closedUntilMs) this.closedStatus = NONE;
  }
  public status(nowMs: number): WindowHelpStatusDTO {
    this.tick(nowMs);
    const active = this.active;
    return active ? { phase: active.phase, requestId: active.requestId,
      target: { ...active.choice.target.preview }, expiresAtMs: active.expiresAtMs } : this.closedStatus;
  }
  public target(): VerifiedWindowHelpTarget | null { return this.active?.choice.target ?? null; }
  public requestId(): string | null { return this.active?.requestId ?? null; }
  public isAssisting(): boolean { return this.active?.phase === 'assisting'; }
  private close(outcome: WindowHelpOutcome, nowMs: number): void {
    if (!this.active) return;
    const { requestId } = this.active;
    this.active = null;
    this.closedStatus = { phase: 'closed', requestId, outcome };
    this.closedUntilMs = nowMs + 10000;
    this.options.cancelGeneration();
    this.options.clearSpeech();
    this.options.closed(requestId, outcome);
  }
  private fresh(target: VerifiedWindowHelpTarget, nowMs: number): boolean {
    return Number.isFinite(nowMs) && Number.isFinite(target.capturedAtMs)
      && nowMs >= target.capturedAtMs && nowMs - target.capturedAtMs <= 300;
  }
  private sameTarget(a: VerifiedWindowHelpTarget, b: VerifiedWindowHelpTarget): boolean {
    return a.surfaceId === b.surfaceId && a.sourceEpoch === b.sourceEpoch
      && a.policyGeneration === b.policyGeneration && a.geometrySignature === b.geometrySignature;
  }
}
