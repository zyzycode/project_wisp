import type { CausalLifeEpisode, CausalLifeSourceReference, ICausalLifeCommitObserver, ICausalLifeRepository } from '../ports/causal-life.interface';
import type { MemoryOperationContext } from '../ports/memory-repository.interface';
import type { MemoryScheduler } from '../ports/memory-runtime';
import { isOwnGameSource } from '../../domain/character/own-game-interest';
import type { CharacterStateService } from './character-state.service';

interface Options {
  readonly repository?: ICausalLifeRepository;
  readonly character: CharacterStateService;
  readonly context: () => MemoryOperationContext | null;
  readonly scheduler: MemoryScheduler;
  readonly now?: () => number;
}
interface ProofRequest {
  readonly epoch: number;
  readonly context: MemoryOperationContext;
  readonly sources: readonly CausalLifeSourceReference[];
  readonly deadline: number;
}
/** A committed callback may teach once; indexed proof reads can only validate existing learning. */
export class OwnGameInterestRuntime implements ICausalLifeCommitObserver {
  private epoch = 0;
  private disposed = false;
  private pending: Promise<void> | null = null;
  private queued: ProofRequest | null = null;
  private cancelRead: (() => void) | undefined;
  private readonly now: () => number;
  constructor(private readonly options: Options) { this.now = options.now ?? (() => performance.now()); }
  committed(episode: CausalLifeEpisode, context: MemoryOperationContext, atMs: number): void {
    if (this.disposed || this.options.context()?.generation !== context.generation) return;
    if (this.options.character.observeCommittedOwnGame(episode, atMs)) void this.revalidate();
  }
  invalidate(): void { this.epoch++; this.options.character.invalidateOwnGameInterestProof(); }
  dispose(): void { this.disposed = true; this.queued = null; this.invalidate(); this.cancelRead?.(); }
  revalidate(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.invalidate();
    const context = this.options.context();
    this.queued = context && this.options.repository ? { context, epoch: this.epoch,
      sources: this.options.character.getState().ownGameInterestSources, deadline: this.now() + 200 } : null;
    return this.pending ?? this.start();
  }
  private start(): Promise<void> {
    this.pending = this.drain().then(() => {
      this.pending = null;
      // A request can arrive between the final await and this completion microtask.
      if (this.queued && !this.disposed) return this.start();
      return undefined;
    });
    return this.pending;
  }
  private async drain(): Promise<void> {
    while (this.queued && !this.disposed) {
      const request = this.queued; this.queued = null;
      await this.validate(request);
    }
  }
  private current(request: ProofRequest): boolean {
    return !this.disposed && request.epoch === this.epoch && this.options.context()?.generation === request.context.generation
      && JSON.stringify(this.options.character.getState().ownGameInterestSources) === JSON.stringify(request.sources);
  }
  private async validate(request: ProofRequest): Promise<void> {
    const repository = this.options.repository;
    if (!repository || !this.current(request)) return;
    if (request.sources.length === 0) { this.options.character.setOwnGameInterestProof([]); return; }
    const remaining = request.deadline - this.now();
    if (remaining <= 0) return;
    let timer: unknown;
    const timeout = new Promise<null>(resolve => {
      this.cancelRead = () => { this.options.scheduler.clearTimeout(timer); resolve(null); };
      timer = this.options.scheduler.setTimeout(() => resolve(null), remaining);
    });
    try {
      const result = await Promise.race([Promise.resolve().then(() => repository.resolveSources(request.sources, request.context)).catch(() => null), timeout]);
      if (!this.current(request) || this.now() > request.deadline || !result?.ok) return;
      const valid: CausalLifeSourceReference[] = [];
      for (const source of request.sources) {
        const matches = result.value.filter(episode => episode.appRunId === source.appRunId && episode.sequence === source.sequence && episode.revision === source.revision);
        if (matches.length === 1 && isOwnGameSource(matches[0]!)) valid.push(source);
      }
      this.options.character.setOwnGameInterestProof(valid);
    } finally { this.options.scheduler.clearTimeout(timer); this.cancelRead = undefined; }
  }
}
