import type { CausalLifeEpisode, ICausalLifeRepository, CausalLifeSourceReference } from '../ports/causal-life.interface';
import type { MemoryOperationContext } from '../ports/memory-repository.interface';
import type { MemoryScheduler } from '../ports/memory-runtime';
import type { ICausalSourceReadBarrier } from '../ports/life-history.interface';
import type { CharacterStateService } from './character-state.service';
import { isRepairInterruption, matchesRepairProof, repairSource, sameRepairSource } from '../../domain/character/relationship-repair';
interface Options {
  readonly character: CharacterStateService;
  readonly repository?: ICausalLifeRepository;
  readonly context: () => MemoryOperationContext | null;
  readonly appRunId: () => string;
  readonly now: () => number;
  readonly scheduler: MemoryScheduler;
  readonly barrier: ICausalSourceReadBarrier;
}
/** One observed completion may reserve the existing gate; no replay, reward queue or storage wait on input. */
export class RelationshipRepairRuntime {
  private epoch = 0;
  private disposed = false;
  private highWater = 0;
  private latestInterruption: { readonly episode: CausalLifeEpisode; readonly atMs: number } | null = null;
  private slot: { readonly episode: CausalLifeEpisode; readonly generation: number; readonly deadline: number; readonly epoch: number; readonly profile: number } | null = null;
  private timer: unknown;
  private cancelRead: (() => void) | undefined;
  constructor(private readonly options: Options) {}
  observed(episode: CausalLifeEpisode, atMs: number): void {
    if (this.disposed || episode.appRunId !== this.options.appRunId() || episode.sequence <= this.highWater) return;
    this.highWater = episode.sequence;
    if (isRepairInterruption(episode)) {
      this.invalidate(); this.latestInterruption = { episode, atMs };
    }
    const reserved = this.options.character.observeCausalEpisode(episode, atMs, episode);
    if (!reserved) return;
    const context = this.options.context();
    if (!context || !this.options.repository) { this.options.character.finishRelationshipRepair(); return; }
    this.slot = { episode, generation: context.generation, deadline: atMs + 200, epoch: this.epoch,
      profile: this.options.character.getCausalAffectGeneration() };
    const remaining = this.slot.deadline - this.options.now();
    if (remaining <= 0) this.finish();
    else this.timer = this.options.scheduler.setTimeout(() => this.finish(), remaining);
  }
  committed(episode: CausalLifeEpisode, context: MemoryOperationContext, atMs: number): void {
    if (this.disposed || episode.appRunId !== this.options.appRunId() || this.options.context()?.generation !== context.generation) return;
    const latest = this.latestInterruption;
    if (latest && JSON.stringify(latest.episode) === JSON.stringify(episode) && latest.atMs === atMs) {
      this.latestInterruption = null;
      this.options.character.acknowledgeRelationshipInterruption(episode, atMs); return;
    }
    const slot = this.slot;
    if (!slot || slot.epoch !== this.epoch || slot.generation !== context.generation
      || slot.profile !== this.options.character.getCausalAffectGeneration()
      || JSON.stringify(slot.episode) !== JSON.stringify(episode)) return;
    this.finish(this.options.now() < slot.deadline ? episode : undefined);
  }
  /** Same-profile lifecycle/source barriers settle the already observed base before discarding callbacks. */
  invalidate(): void {
    this.epoch++; this.finish(); this.latestInterruption = null; this.cancelRead?.();
    this.options.character.invalidateRelationshipRepair();
  }
  reset(): void { this.highWater = 0; this.epoch++; this.slot = null; this.options.scheduler.clearTimeout(this.timer); this.timer = undefined; this.latestInterruption = null; this.cancelRead?.(); }
  dispose(): void { this.invalidate(); this.disposed = true; }
  private finish(episode?: CausalLifeEpisode): void {
    const slot = this.slot; this.slot = null;
    this.options.scheduler.clearTimeout(this.timer); this.timer = undefined;
    if (slot && slot.profile === this.options.character.getCausalAffectGeneration()) this.options.character.finishRelationshipRepair(episode);
  }
  /** Exact indexed proof plus pending append barrier share one 200ms budget. */
  async revalidate(): Promise<void> {
    this.invalidate();
    const context = this.options.context(), repository = this.options.repository;
    const marker = this.options.character.getState().relationshipRepair;
    const source: CausalLifeSourceReference | null = marker.lastInterruptionSource;
    if (this.disposed || !context || !repository || !source) return;
    const epoch = this.epoch, profile = this.options.character.getCausalAffectGeneration(), deadline = this.options.now() + 200;
    let timer: unknown;
    const timeout = new Promise<null>(resolve => {
      this.cancelRead = () => { this.options.scheduler.clearTimeout(timer); resolve(null); };
      timer = this.options.scheduler.setTimeout(() => resolve(null), 200);
    });
    const read = async () => {
      if (this.options.barrier.snapshot().pending) await this.options.barrier.whenSettled();
      if (this.disposed || epoch !== this.epoch || this.options.now() >= deadline || this.options.context()?.generation !== context.generation) return null;
      return repository.resolveSources([source], context);
    };
    try {
      const result = await Promise.race([read().catch(() => null), timeout]);
      if (this.disposed || epoch !== this.epoch || profile !== this.options.character.getCausalAffectGeneration()
        || this.options.context()?.generation !== context.generation || this.options.now() >= deadline || !result?.ok
        || !sameRepairSource(this.options.character.getState().relationshipRepair.lastInterruptionSource, source)) return;
      const matches = result.value.filter(e => sameRepairSource(repairSource(e), source) && matchesRepairProof(marker, e));
      if (matches.length === 1) this.options.character.setRelationshipRepairProof(matches[0]!);
    } finally { this.options.scheduler.clearTimeout(timer); this.cancelRead = undefined; }
  }
}
