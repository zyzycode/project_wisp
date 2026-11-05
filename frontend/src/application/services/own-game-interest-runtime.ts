import type { CausalLifeEpisode, CausalLifeSourceReference, ICausalLifeCommitObserver, ICausalLifeRepository } from '../ports/causal-life.interface';
import type { MemoryOperationContext } from '../ports/memory-repository.interface';
import type { MemoryScheduler } from '../ports/memory-runtime';
import { isOwnBookSource } from '../../domain/character/own-book-interest';
import { isOwnGameSource } from '../../domain/character/own-game-interest';
import type { CharacterStateService } from './character-state.service';

interface Options {
  readonly appRunId?: () => string;
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
  readonly bookSources: readonly CausalLifeSourceReference[];
  readonly deadline: number;
}
/** A committed callback may teach once; indexed proof reads can only validate existing learning. */
export class OwnGameInterestRuntime implements ICausalLifeCommitObserver {
  private epoch = 0;
  private disposed = false;
  private pending: Promise<void> | null = null;
  private queued: ProofRequest | null = null;
  private readonly cancelReads = new Set<() => void>();
  private readonly now: () => number;
  constructor(private readonly options: Options) { this.now = options.now ?? (() => performance.now()); }
  committed(episode: CausalLifeEpisode, context: MemoryOperationContext, atMs: number): void {
    if (this.disposed || this.options.context()?.generation !== context.generation) return;
    const accepted = episode.activity === 'book'
      ? this.options.appRunId && this.options.character.observeCommittedOwnBook(episode, atMs, this.options.appRunId())
      : this.options.character.observeCommittedOwnGame(episode, atMs);
    if (accepted) void this.revalidate();
  }
  invalidate(): void { this.epoch++; this.options.character.invalidateOwnGameInterestProof(); this.options.character.invalidateOwnBookInterestProof(); }
  dispose(): void { this.disposed = true; this.queued = null; this.invalidate(); for (const cancel of this.cancelReads) cancel(); this.cancelReads.clear(); }
  revalidate(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.invalidate();
    const context = this.options.context();
    this.queued = context && this.options.repository ? { context, epoch: this.epoch,
      sources: this.options.character.getState().ownGameInterestSources, bookSources: this.options.character.getState().ownBookInterestSources, deadline: this.now() + 200 } : null;
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
      await Promise.all([this.validate(request, false), this.validate(request, true)]);
    }
  }
  private current(request: ProofRequest, book: boolean): boolean {
    return !this.disposed && request.epoch === this.epoch && this.options.context()?.generation === request.context.generation
      && JSON.stringify(book ? this.options.character.getState().ownBookInterestSources : this.options.character.getState().ownGameInterestSources) === JSON.stringify(book ? request.bookSources : request.sources);
  }
  private async validate(request: ProofRequest, book: boolean): Promise<void> {
    const repository = this.options.repository;
    const sources = book ? request.bookSources : request.sources;
    const publish = (refs: readonly CausalLifeSourceReference[]) => book ? this.options.character.setOwnBookInterestProof(refs) : this.options.character.setOwnGameInterestProof(refs);
    if (!repository || !this.current(request, book)) return;
    if (sources.length === 0) { publish([]); return; }
    const remaining = request.deadline - this.now();
    if (remaining <= 0) return;
    let timer: unknown;
    let cancelRead: (() => void) | undefined;
    const timeout = new Promise<null>(resolve => {
      cancelRead = () => { this.options.scheduler.clearTimeout(timer); resolve(null); };
      this.cancelReads.add(cancelRead);
      timer = this.options.scheduler.setTimeout(() => resolve(null), remaining);
    });
    try {
      const result = await Promise.race([Promise.resolve().then(() => repository.resolveSources(sources, request.context)).catch(() => null), timeout]);
      if (!this.current(request, book) || this.now() > request.deadline || !result?.ok) return;
      const valid: CausalLifeSourceReference[] = [];
      for (const source of sources) {
        const matches = result.value.filter(episode => episode.appRunId === source.appRunId && episode.sequence === source.sequence && episode.revision === source.revision);
        if (matches.length === 1 && (book ? isOwnBookSource(matches[0]!) : isOwnGameSource(matches[0]!))) valid.push(source);
      }
      publish(valid);
    } finally { this.options.scheduler.clearTimeout(timer); if (cancelRead) this.cancelReads.delete(cancelRead); }
  }
}
