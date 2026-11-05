import type { ICausalSourceReadBarrier } from '../ports/life-history.interface';
import type { CausalLifeEpisode, ICausalLifeCommitObserver, ICausalLifeRepository } from '../ports/causal-life.interface';
import type { ActivityOutcomeFeedback } from '../ports/shimeji-feedback-port';
import type { MemoryFailureCode, MemoryOperationContext } from '../ports/memory-repository.interface';

interface Options {
  readonly repository?: ICausalLifeRepository;
  readonly appRunId: () => string;
  readonly context: () => MemoryOperationContext | null;
  readonly generation: () => number;
  readonly toTimestamp: (atMs: number) => string;
  readonly onFailure: (code: MemoryFailureCode) => void;
  readonly commitObserver?: ICausalLifeCommitObserver;
  readonly onObserved?: (episode: CausalLifeEpisode, atMs: number) => void;
}
/** Trusted observed facts remain usable offline; storage acknowledgement is a separate boundary. */
export class CausalLifeRecorder implements ICausalSourceReadBarrier {
  private revision = 0;
  private pendingWrites = 0;
  private settled: Promise<void> = Promise.resolve();
  private settle: (() => void) | undefined;
  snapshot() { return { generation: this.options.generation(), revision: this.revision, pending: this.pendingWrites > 0 }; }
  whenSettled(): Promise<void> { return this.settled; }
  invalidate(): void { this.revision++; }
  private sequence = 0;
  private disposed = false;
  private input: { readonly sequence: number; readonly generation: number; readonly acceptedDrag: boolean; contact: { readonly episode: CausalLifeEpisode; readonly atMs: number } | null } | null = null;
  private terminalHighWater = 0;
  constructor(private readonly options: Options) {}
  beginInput(contact: boolean, atMs: number, acceptedDrag = false): void {
    if (this.disposed || !Number.isFinite(atMs) || this.sequence >= Number.MAX_SAFE_INTEGER) return;
    const sequence = ++this.sequence;
    this.input = { sequence, generation: this.options.generation(), acceptedDrag, contact: null };
    if (contact) {
      const episode: CausalLifeEpisode = { ...this.base(sequence, atMs), source: 'user', triggerSequence: null,
        activityRunId: null, activity: null, outcome: null, terminalReason: null, cause: 'contact', executedMs: 0, participation: 'none' };
      this.input.contact = { episode, atMs };
      this.emit(episode, atMs, false);
    }
  }
  dispose(): void { this.invalidate(); this.disposed = true; this.input = null; }
  endInput(): void {
    const contact = this.input?.generation === this.options.generation() ? this.input.contact : null;
    this.input = null;
    if (contact && !this.disposed) this.options.onObserved?.(contact.episode, contact.atMs);
  }
  outcome(event: ActivityOutcomeFeedback): void {
    if (this.disposed || !Number.isSafeInteger(event.activitySequence)
      || event.activitySequence! <= this.terminalHighWater || !Number.isFinite(event.atMs)
      || !Number.isFinite(event.executedMs) || event.executedMs < 0 || event.executedMs > 600000 || this.sequence >= Number.MAX_SAFE_INTEGER) return;
    this.terminalHighWater = event.activitySequence!;
    // A contact that ends any real run is not a harmless repetition, even before 1000ms.
    if (this.input) this.input.contact = null;
    if (event.activity !== 'cursor_game' && event.activity !== 'book') return;
    const input = this.input?.generation === this.options.generation() ? this.input : null;
    const reason = event.terminalReason ?? null;
    const cause = event.outcome === 'completed' ? 'completed'
      : (reason === 'user_interaction' || (event.activity === 'book' && reason === 'forced_motion' && input?.acceptedDrag)) && input ? 'user_interrupted'
      : reason === 'environment_invalidated' ? 'environment_lost'
      : reason === 'step_timeout' ? 'timeout'
      : reason === null || reason === 'user_interaction' ? 'unknown' : 'other';
    this.emit({ ...this.base(++this.sequence, event.atMs), activityRunId: event.activityRunId, activity: event.activity,
      outcome: event.outcome, terminalReason: reason, cause, triggerSequence: cause === 'user_interrupted' ? input!.sequence : null,
      source: cause === 'user_interrupted' ? 'user' : cause === 'unknown' ? 'unknown' : cause === 'completed' ? 'autonomy' : 'system',
      executedMs: event.executedMs, participation: event.activity === 'book' ? 'solitary' : event.participation }, event.atMs);
  }
  reset(): void { this.invalidate(); this.sequence = 0; this.input = null; /* Runtime activity sequence survives memory reset; old terminal callbacks remain stale. */ }
  private base(sequence: number, atMs: number) {
    return { appRunId: this.options.appRunId(), sequence, revision: 1 as const, occurredAt: this.options.toTimestamp(atMs) };
  }
  private emit(episode: CausalLifeEpisode, atMs: number, observe = true): void {
    if (observe) this.options.onObserved?.(episode, atMs);
    this.invalidate();
    const context = this.options.context(), repository = this.options.repository;
    if (!context || !repository) return;
    // Worker queue and generation barrier own backpressure; never await storage on input/tick.
    const appRunId = this.options.appRunId();
    if (this.pendingWrites++ === 0) this.settled = new Promise(resolve => { this.settle = resolve; });
    const append = () => { try { return repository.append(episode, context); } catch (error) { return Promise.reject(error); } };
    void append().then(result => {
      if (!this.disposed && this.options.appRunId() === appRunId && this.options.context()?.generation === context.generation && result.ok) this.options.commitObserver?.committed(episode, context, atMs);
      if (this.options.context()?.generation === context.generation && !result.ok) this.options.onFailure(result.code);
    }).catch(() => { if (this.options.context()?.generation === context.generation) this.options.onFailure('unavailable'); }).finally(() => { if (--this.pendingWrites === 0) { this.settle?.(); this.settle = undefined; } });
  }
}
