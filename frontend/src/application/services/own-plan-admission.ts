import type { MotivationRecord, OwnPlanStep } from '../ports/motivation.interface';
import type { MemoryOperationContext } from '../ports/memory-repository.interface';
import { cancelOwnPlan, claimOwnPlan, ownPlanActivityMatches, selectedOwnPlanStep } from '../../domain/character/own-plans';
import type { GoalNeeds } from '../../domain/character/own-goals';

interface Offer {
  readonly step: OwnPlanStep; readonly goalId: string; readonly token: string; readonly appRunId: string;
  readonly epoch: number; readonly context: MemoryOperationContext; readonly start: () => boolean;
  cancelled: boolean; started: boolean; notified: boolean;
}
export interface PlanOutcome {
  readonly appRunId: string; readonly stepToken: string; readonly runId: string;
  readonly result: 'completed' | 'cancelled' | 'failed'; readonly now: string;
}
interface Options {
  readonly record: () => MotivationRecord | null;
  readonly now: () => string | null;
  readonly needs: () => GoalNeeds;
  readonly eligible: () => boolean;
  readonly current: (epoch: number, generation: number) => boolean;
  readonly save: (value: MotivationRecord, context: MemoryOperationContext, epoch: number) => Promise<boolean>;
  readonly finished: () => void;
}
/** Only transient admission identities; the parent runtime owns the sole cache and write queue. */
export class OwnPlanAdmission {
  private request: Offer | null = null;
  private active: Offer | null = null;
  private dispatching: Offer | null = null;
  private binding: { readonly offer: Offer; readonly runId: string } | null = null;
  private outcome: PlanOutcome | null = null;
  private usedGoal: string | null = null;
  private readonly usedRuns = new Set<string>();
  constructor(private readonly options: Options) {}
  hasWork(): boolean { return this.request !== null || this.outcome !== null; }
  offer(step: OwnPlanStep, context: MemoryOperationContext, epoch: number, appRunId: string, token: string, start: () => boolean): boolean {
    const record = this.options.record(), now = this.options.now();
    if (!record?.plan || !now || !this.options.eligible() || selectedOwnPlanStep(record, this.options.needs(), now) !== step) return false;
    if (this.request || this.active || this.binding) return true;
    this.request = { step, goalId: record.plan.goalId, token, appRunId, context, epoch, start,
      cancelled: false, started: false, notified: false };
    return true;
  }
  interrupt(): void {
    if (this.request) { this.request.cancelled = true; this.finish(this.request); this.request = null; }
    if (this.active && !this.active.started) { this.active.cancelled = true; this.finish(this.active); }
  }
  clear(): void { this.interrupt(); this.binding = null; this.outcome = null; this.usedGoal = null; this.usedRuns.clear(); }
  started(runId: string, activityId: string): boolean {
    const offer = this.dispatching;
    if (!offer) { this.interrupt(); return false; }
    if (this.usedGoal !== offer.goalId) { this.usedGoal = offer.goalId; this.usedRuns.clear(); }
    if (!this.live(offer) || !ownPlanActivityMatches(offer.step, activityId) || this.usedRuns.has(runId)) return false;
    this.usedRuns.add(runId); offer.started = true; this.binding = { offer, runId }; return true;
  }
  terminal(runId: string, result: PlanOutcome['result']): boolean {
    const binding = this.binding, now = this.options.now();
    if (!binding || binding.runId !== runId || !now) return false;
    this.binding = null;
    if (this.options.current(binding.offer.epoch, binding.offer.context.generation)) {
      this.outcome = { appRunId: binding.offer.appRunId, stepToken: binding.offer.token, runId, result, now };
    }
    return true;
  }
  takeOutcome(): PlanOutcome | null { const outcome = this.outcome; this.outcome = null; return outcome; }
  async process(): Promise<void> {
    const offer = this.request; this.request = null;
    if (!offer) return;
    this.active = offer;
    try {
      const record = this.options.record(), now = this.options.now();
      if (!record || !now || !this.live(offer) || !this.options.eligible() || record.plan?.goalId !== offer.goalId) return;
      const claimed = claimOwnPlan(record, this.options.needs(), now, offer.appRunId, offer.token);
      if (!claimed || !await this.options.save(claimed, offer.context, offer.epoch)) return;
      const current = this.options.record(), fresh = this.options.now();
      if (!current?.plan || !fresh || !this.live(offer) || !this.options.eligible()
        || current.plan.claim?.stepToken !== offer.token
        || selectedOwnPlanStep({ ...current, plan: { ...current.plan, claim: null } }, this.options.needs(), fresh) !== offer.step) {
        await this.abandon(offer); return;
      }
      this.dispatching = offer;
      try { offer.start(); } finally { this.dispatching = null; }
      // A committed run can synchronously fail its first visual; its terminal is still authoritative.
      if (!offer.started) await this.abandon(offer);
    } catch { await this.abandon(offer); }
    finally { this.active = null; if (!offer.started) this.finish(offer); }
  }
  private live(offer: Offer): boolean { return !offer.cancelled && this.options.current(offer.epoch, offer.context.generation); }
  private finish(offer: Offer): void { if (!offer.notified) { offer.notified = true; this.options.finished(); } }
  private async abandon(offer: Offer): Promise<void> {
    const record = this.options.record(), now = this.options.now();
    if (!record?.plan || !now || !this.options.current(offer.epoch, offer.context.generation)
      || record.plan.claim?.stepToken !== offer.token) return;
    await this.options.save(cancelOwnPlan(record, now, 'abandoned'), offer.context, offer.epoch);
  }
}
