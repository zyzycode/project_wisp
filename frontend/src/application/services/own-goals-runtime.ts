import type { IMotivationRepository, IOwnGoalsRuntime, MotivationRecord } from '../ports/motivation.interface';
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
  constructor(private readonly options: Options) {}
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
    if (!now || !this.loaded || this.unavailable || this.cancelRequested || this.disposed || record?.plan
      || context?.generation !== this.cacheGeneration || !this.options.eligible()) return null;
    const goal = activeOwnGoal(record, needs, now);
    return goal && !this.settledGoals.has(goal.id) ? goal.kind : null;
  }
  activityStarted(runId: string, activityId: string): void {
    this.binding = null;
    const now = this.timestamp(), context = this.options.context();
    if (!now || !context || context.generation !== this.cacheGeneration || !this.loaded || !this.cache || this.cache.plan || this.disposed
      || this.unavailable || this.cancelRequested) return;
    const kind = ownGoalActivityKind(activityId);
    const goal = this.cache.goals.find(g => g.kind === kind && g.status === 'pending'
      && !this.settledGoals.has(g.id) && g.createdAt <= now && now < g.expiresAt);
    if (goal) this.binding = { goalId: goal.id, runId, generation: context.generation, epoch: this.epoch,
      stepToken: this.options.createId('step') };
  }
  activityOutcome(runId: string, result: 'completed' | 'cancelled' | 'failed'): void {
    const binding = this.binding, now = this.timestamp();
    if (!binding || binding.runId !== runId || !now || this.disposed) return;
    this.binding = null;
    if (!this.current(binding.epoch, binding.generation) || this.settledGoals.has(binding.goalId)) return;
    this.settledGoals.add(binding.goalId);
    this.outcomes.set(binding.goalId, { binding, result, now });
    void this.start();
  }
  cancel(): Promise<void> {
    this.epoch++; this.cache = null; this.loaded = false; this.cacheGeneration = -1; this.binding = null;
    this.requested = null; this.outcomes.clear(); this.cancelRequested = true;
    this.settledGoals.clear();
    return this.start();
  }
  invalidate(): void {
    this.epoch++; this.cache = null; this.loaded = false; this.cacheGeneration = -1; this.binding = null;
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
        && (this.cancelRequested || this.requested || this.outcomes.size)) return this.start();
      return undefined;
    });
    return this.pending;
  }
  private async drain(): Promise<void> {
    while (!this.disposed && !this.unavailable && this.options.context()
      && (this.cancelRequested || this.requested || this.outcomes.size)) {
      const context = this.options.context();
      const now = this.timestamp(), repository = this.options.repository;
      if (!context || !now || !repository) { this.requested = null; this.outcomes.clear(); this.cancelRequested = false; return; }
      const epoch = this.epoch;
      const cancel = this.cancelRequested;
      const outcome = cancel ? undefined : this.outcomes.values().next().value;
      const request = !cancel && !outcome ? this.requested : null;
      if (cancel) this.cancelRequested = false;
      else if (outcome) this.outcomes.delete(outcome.binding.goalId);
      else this.requested = null;
      try {
        if (this.cacheGeneration !== context.generation) { this.cache = null; this.loaded = false; }
        if (!this.loaded || request === 'restore') {
          const result = await repository.read(now, context);
          if (!this.current(epoch, context.generation)) continue;
          if (!result.ok) { this.fail(result.code); continue; }
          this.cache = result.value; this.loaded = true; this.cacheGeneration = context.generation;
          for (const id of this.settledGoals) if (!this.cache?.goals.some(g => g.id === id)) this.settledGoals.delete(id);
        }
        if (!this.current(epoch, context.generation)) continue;
        const previous = this.cache;
        let next: MotivationRecord | null = previous;
        if (cancel && previous) next = cancelOwnGoals(previous, now);
        else if (outcome && previous && this.current(outcome.binding.epoch, outcome.binding.generation)) {
          next = finishOwnGoal(previous, outcome.binding.goalId, outcome.result, outcome.now);
        } else if (request === 'opportunity' && this.options.eligible() && !previous?.plan) {
          const freshNow = this.timestamp();
          if (freshNow) next = evaluateOwnGoals(previous ?? initialMotivation(freshNow), this.options.getNeeds(), freshNow,
            kind => this.options.createId(kind));
        }
        if (!next || next.revision === 0 || (previous && JSON.stringify(next) === JSON.stringify(previous))) continue;
        const result = await repository.replace(next, previous?.revision ?? null, context);
        if (!this.current(epoch, context.generation)) continue;
        if (!result.ok) { this.fail(result.code); continue; }
        this.cache = next; this.loaded = true; this.cacheGeneration = context.generation;
        for (const id of this.settledGoals) if (!next.goals.some(g => g.id === id)) this.settledGoals.delete(id);
      } catch { if (this.current(epoch, context.generation)) this.fail('unavailable'); }
    }
  }
  private fail(code: MemoryFailureCode): void {
    this.cache = null; this.loaded = false; this.cacheGeneration = -1; this.binding = null;
    this.unavailable = code !== 'conflict' && code !== 'busy' && code !== 'stale';
    if (this.unavailable) this.options.onFailure?.(code);
  }
}
