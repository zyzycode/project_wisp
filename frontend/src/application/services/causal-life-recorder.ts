import type { CausalLifeEpisode, ICausalLifeRepository } from '../ports/causal-life.interface';
import type { ActivityOutcomeFeedback } from '../ports/shimeji-feedback-port';
import type { MemoryFailureCode, MemoryOperationContext } from '../ports/memory-repository.interface';

interface Options {
  readonly repository?: ICausalLifeRepository;
  readonly appRunId: () => string;
  readonly context: () => MemoryOperationContext | null;
  readonly generation: () => number;
  readonly toTimestamp: (atMs: number) => string;
  readonly onFailure: (code: MemoryFailureCode) => void;
  readonly onObserved?: (episode: CausalLifeEpisode, atMs: number) => void;
}
/** Trusted observed facts remain usable offline; storage acknowledgement is a separate boundary. */
export class CausalLifeRecorder {
  private sequence = 0;
  private disposed = false;
  private input: { readonly sequence: number; readonly generation: number } | null = null;
  private terminalHighWater = 0;
  constructor(private readonly options: Options) {}
  beginInput(contact: boolean, atMs: number): void {
    if (this.disposed || !Number.isFinite(atMs) || this.sequence >= Number.MAX_SAFE_INTEGER) return;
    const sequence = ++this.sequence;
    this.input = { sequence, generation: this.options.generation() };
    if (contact) this.emit({ ...this.base(sequence, atMs), source: 'user', triggerSequence: null,
      activityRunId: null, activity: null, outcome: null, terminalReason: null, cause: 'contact', executedMs: 0, participation: 'none' }, atMs);
  }
  dispose(): void { this.disposed = true; this.input = null; }
  endInput(): void { this.input = null; }
  outcome(event: ActivityOutcomeFeedback): void {
    if (this.disposed || event.activity !== 'cursor_game' || !Number.isSafeInteger(event.activitySequence)
      || event.activitySequence! <= this.terminalHighWater || !Number.isFinite(event.atMs)
      || !Number.isFinite(event.executedMs) || event.executedMs < 0 || event.executedMs > 600000 || this.sequence >= Number.MAX_SAFE_INTEGER) return;
    this.terminalHighWater = event.activitySequence!;
    const input = this.input?.generation === this.options.generation() ? this.input : null;
    const reason = event.terminalReason ?? null;
    const cause = event.outcome === 'completed' ? 'completed'
      : reason === 'user_interaction' && input ? 'user_interrupted'
      : reason === 'environment_invalidated' ? 'environment_lost'
      : reason === 'step_timeout' ? 'timeout'
      : reason === null || reason === 'user_interaction' ? 'unknown' : 'other';
    this.emit({ ...this.base(++this.sequence, event.atMs), activityRunId: event.activityRunId, activity: 'cursor_game',
      outcome: event.outcome, terminalReason: reason, cause, triggerSequence: cause === 'user_interrupted' ? input!.sequence : null,
      source: cause === 'user_interrupted' ? 'user' : cause === 'unknown' ? 'unknown' : cause === 'completed' ? 'autonomy' : 'system',
      executedMs: event.executedMs, participation: event.participation }, event.atMs);
  }
  reset(): void { this.sequence = 0; this.input = null; /* Runtime activity sequence survives memory reset; old terminal callbacks remain stale. */ }
  private base(sequence: number, atMs: number) {
    return { appRunId: this.options.appRunId(), sequence, revision: 1 as const, occurredAt: this.options.toTimestamp(atMs) };
  }
  private emit(episode: CausalLifeEpisode, atMs: number): void {
    this.options.onObserved?.(episode, atMs);
    const context = this.options.context(), repository = this.options.repository;
    if (!context || !repository) return;
    // Worker queue and generation barrier own backpressure; never await storage on input/tick.
    void repository.append(episode, context).then(result => {
      if (this.options.context()?.generation === context.generation && !result.ok) this.options.onFailure(result.code);
    }).catch(() => { if (this.options.context()?.generation === context.generation) this.options.onFailure('unavailable'); });
  }
}
