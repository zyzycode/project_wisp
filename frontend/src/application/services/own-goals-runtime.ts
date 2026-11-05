import type { IMotivationRepository, IOwnGoalsRuntime, MotivationRecord, OwnPlanStep } from '../ports/motivation.interface';
import { OwnPlanAdmission } from './own-plan-admission';
import { prepareOwnPlan, selectedOwnPlanStep, finishOwnPlan } from '../../domain/character/own-plans';
import type { MemoryFailureCode, MemoryOperationContext } from '../ports/memory-repository.interface';
import { activeOwnGoal, cancelOwnGoals, evaluateOwnGoals, finishOwnGoal, initialMotivation, ownGoalActivityKind, ownGoalSelectionMultiplier,
  type GoalNeeds, type OwnGoalKind } from '../../domain/character/own-goals';

interface Options {
  readonly repository?: IMotivationRepository;
  readonly context: () => MemoryOperationContext | null;
  readonly wallNow: () => number;
  readonly getNeeds: () => GoalNeeds;
  readonly eligible: () => boolean;
  readonly createId: (kind: OwnGoalKind | 'step') => string;
  readonly planning?: { readonly appRunId: () => string | null; readonly onOpportunityFinished: () => void };
  readonly onFailure?: (code: MemoryFailureCode) => void;
}
interface Binding { readonly goalId: string; readonly runId: string; readonly stepToken: string; readonly generation: number; readonly epoch: number; }
interface Outcome { readonly binding: Binding; readonly result: 'completed' | 'cancelled' | 'failed'; readonly now: string; }
/** Durable optional motivation; never owns an executor, timer, RNG or Activity reward. */
export class OwnGoalsRuntime implements IOwnGoalsRuntime {
  private epoch = 0;
  private disposed = false;
  private unavailable = false;
  private loaded = false;
  private cacheGeneration = -1;
  private cache: MotivationRecord | null = null;
  private pending: Promise<void> | null = null;
  private requested: 'restore' | 'opportunity' | null = null;
  private cancelRequested = false;
  private binding: Binding | null = null;
  private readonly outcomes = new Map<string, Outcome>();
  private readonly settledGoals = new Set<string>();
  private restoredPlan = false;
  private readonly plans: OwnPlanAdmission;
  constructor(private readonly options: Options) {
    this.plans = new OwnPlanAdmission({ record: () => this.cache, now: () => this.timestamp(), needs: options.getNeeds,
      eligible: options.eligible, current: (epoch, generation) => this.current(epoch, generation),
      save: (value, context, epoch) => this.save(value, context, epoch),
      finished: () => { if (!this.disposed) options.planning?.onOpportunityFinished(); } });
  }
  restore(): Promise<void> { this.unavailable = false; this.requested = 'restore'; return this.start(); }
  opportunity(): void {
    if (this.disposed || this.unavailable || !this.options.repository || !this.options.context() || !this.options.eligible()) return;
    this.requested = 'opportunity'; void this.start();
  }
  multiplier(activity: string): number {
    return ownGoalSelectionMultiplier(this.selectedGoalKind(), activity);
  }
  selectedGoalKind(): OwnGoalKind | null {
    const now = this.timestamp(), record = this.cache, context = this.options.context(), needs = this.options.getNeeds();
    if (!now || !this.loaded || this.unavailable || this.cancelRequested || this.disposed
      || context?.generation !== this.cacheGeneration || !this.options.eligible()) return null;
    const goal = activeOwnGoal(record, needs, now);
    return goal && !(record?.plan?.goalId === goal.id) && !this.settledGoals.has(goal.id) ? goal.kind : null;
  }
  selectedPlanStep(): OwnPlanStep | null {
    if (!this.options.planning || this.restoredPlan || !this.loaded || this.unavailable || this.cancelRequested || this.disposed
      || this.options.context()?.generation !== this.cacheGeneration || !this.options.eligible()) return null;
    const now = this.timestamp(); return now ? selectedOwnPlanStep(this.cache, this.options.getNeeds(), now) : null;
  }
  offerPlanStep(step: OwnPlanStep, start: () => boolean): boolean {
    const context = this.options.context(), appRunId = this.options.planning?.appRunId();
    if (!context || !appRunId || this.selectedPlanStep() !== step) return false;
    const accepted = this.plans.offer(step, context, this.epoch, appRunId, this.options.createId('step'), start);
    if (accepted) void this.start(); return accepted;
  }
  interruptPlanAdmission(): void { this.plans.interrupt(); }
  activityStarted(runId: string, activityId: string): void {
    this.binding = null;
    if (this.plans.started(runId, activityId)) return;
    const now = this.timestamp(), context = this.options.context();
    if (!now || !context || context.generation !== this.cacheGeneration || !this.loaded || !this.cache || this.disposed
      || this.unavailable || this.cancelRequested) return;
    const kind = ownGoalActivityKind(activityId);
    const goal = this.cache.goals.find(g => g.kind === kind && g.id !== this.cache?.plan?.goalId && g.status === 'pending'
      && !this.settledGoals.has(g.id) && g.createdAt <= now && now < g.expiresAt);
    if (goal) this.binding = { goalId: goal.id, runId, generation: context.generation, epoch: this.epoch,
      stepToken: this.options.createId('step') };
  }
  activityOutcome(runId: string, result: 'completed' | 'cancelled' | 'failed'): void {
    if (this.plans.terminal(runId, result)) { void this.start(); return; }
    const binding = this.binding, now = this.timestamp();
    if (!binding || binding.runId !== runId || !now || this.disposed) return;
    this.binding = null;
    if (!this.current(binding.epoch, binding.generation) || this.settledGoals.has(binding.goalId)) return;
    this.settledGoals.add(binding.goalId);
    this.outcomes.set(binding.goalId, { binding, result, now });
    void this.start();
  }
  cancel(): Promise<void> {
    this.epoch++; this.plans.clear(); this.restoredPlan = false; this.cache = null; this.loaded = false; this.cacheGeneration = -1; this.binding = null;
    this.requested = null; this.outcomes.clear(); this.cancelRequested = true;
    this.settledGoals.clear();
    return this.start();
  }
  invalidate(): void {
    this.epoch++; this.plans.clear(); this.restoredPlan = false; this.cache = null; this.loaded = false; this.cacheGeneration = -1; this.binding = null;
    this.requested = null; this.outcomes.clear(); this.unavailable = false;
    this.settledGoals.clear();
  }
  dispose(): void {
    this.disposed = true; this.cancelRequested = false; this.invalidate();
  }
  private timestamp(): string | null {
    const value = this.options.wallNow();
    return Number.isFinite(value) && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
  }
  private current(epoch: number, generation: number): boolean {
    return !this.disposed && this.epoch === epoch && this.options.context()?.generation === generation;
  }
  private start(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.drain().then(() => {
      this.pending = null;
      if (!this.options.context()) this.requested = null;
      if (!this.disposed && this.options.context() && !this.unavailable
        && (this.cancelRequested || this.requested || this.outcomes.size || this.plans.hasWork())) return this.start();
      return undefined;
    });
    return this.pending;
  }
  private async drain(): Promise<void> {
    while (!this.disposed && !this.unavailable && this.options.context()
      && (this.cancelRequested || this.requested || this.outcomes.size || this.plans.hasWork())) {
      const context = this.options.context();
      const now = this.timestamp(), repository = this.options.repository;
      if (!context || !now || !repository) { this.requested = null; this.outcomes.clear(); this.cancelRequested = false; return; }
      const epoch = this.epoch;
      const cancel = this.cancelRequested;
      const outcome = cancel ? undefined : this.outcomes.values().next().value;
      const planOutcome = !cancel && !outcome ? this.plans.takeOutcome() : null;
      const planRequest = !cancel && !outcome && !planOutcome && this.plans.hasWork();
      const request = !cancel && !outcome && !planOutcome && !planRequest ? this.requested : null;
      if (cancel) this.cancelRequested = false;
      else if (outcome) this.outcomes.delete(outcome.binding.goalId);
      else if (request) this.requested = null;
      try {
        if (this.cacheGeneration !== context.generation) { this.cache = null; this.loaded = false; }
        if (!this.loaded || request === 'restore') {
          const result = request === 'restore' && this.options.planning && repository.restore
            ? await repository.restore(now, context) : await repository.read(now, context);
          if (!this.current(epoch, context.generation)) continue;
          if (!result.ok) { this.fail(result.code); continue; }
          this.cache = result.value; this.loaded = true; this.cacheGeneration = context.generation;
          if (request === 'restore' && this.options.planning) this.restoredPlan = this.cache?.plan !== null && this.cache?.plan !== undefined;
          for (const id of this.settledGoals) if (!this.cache?.goals.some(g => g.id === id)) this.settledGoals.delete(id);
        }
        if (!this.current(epoch, context.generation)) continue;
        if (planRequest) { await this.plans.process(); continue; }
        const previous = this.cache;
        let next: MotivationRecord | null = previous;
        if (cancel && previous) next = cancelOwnGoals(previous, now);
        else if (outcome && previous && this.current(outcome.binding.epoch, outcome.binding.generation)) {
          next = finishOwnGoal(previous, outcome.binding.goalId, outcome.result, outcome.now);
        } else if (planOutcome && previous) {
          next = finishOwnPlan(previous, planOutcome.now, planOutcome);
        } else if (request === 'opportunity' && this.options.eligible()) {
          const freshNow = this.timestamp();
          if (freshNow) {
            next = evaluateOwnGoals(previous ?? initialMotivation(freshNow), this.options.getNeeds(), freshNow, kind => this.options.createId(kind));
            if (this.options.planning) next = prepareOwnPlan(next, this.options.getNeeds(), freshNow, this.restoredPlan);
          }
        }
        if (!next || next.revision === 0 || (previous && JSON.stringify(next) === JSON.stringify(previous))) {
          if (request === 'opportunity' && this.options.eligible()) this.restoredPlan = false;
          continue;
        }
        next = { ...next, revision: (previous?.revision ?? 0) + 1 };
        if (!await this.save(next, context, epoch)) continue;
        if (request === 'opportunity') this.restoredPlan = false;
        for (const id of this.settledGoals) if (!next.goals.some(g => g.id === id)) this.settledGoals.delete(id);
      } catch { if (this.current(epoch, context.generation)) this.fail('unavailable'); }
    }
  }
  private async save(value: MotivationRecord, context: MemoryOperationContext, epoch: number): Promise<boolean> {
    if (!this.options.repository || !this.current(epoch, context.generation)) return false;
    const result = await this.options.repository.replace(value, this.cache?.revision ?? null, context);
    if (!this.current(epoch, context.generation)) return false;
    if (!result.ok) { this.fail(result.code); return false; }
    this.cache = value; this.loaded = true; this.cacheGeneration = context.generation; return true;
  }
  private fail(code: MemoryFailureCode): void {
    this.cache = null; this.loaded = false; this.cacheGeneration = -1; this.binding = null;
    this.unavailable = code !== 'conflict' && code !== 'busy' && code !== 'stale';
    if (this.unavailable) this.options.onFailure?.(code);
  }
}
