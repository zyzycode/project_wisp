import type { CausalLifeEpisode } from '../ports/causal-life.interface';
import type { SocialInterpretation } from '../ports/social-interpretation.interface';
import { cancelCoping, commitCoping, considerCoping, createCopingState, finishCoping, observeCoping,
  selectCoping, type CopingContext, type CopingStrategy } from '../../domain/character/coping';
import type { CharacterStateService } from './character-state.service';

interface Options {
  readonly character: Pick<CharacterStateService, 'getCausalAffectGeneration' | 'getCausalEmotion' | 'getState' | 'relieveCausalInterruption'>;
  readonly appRunId: () => string;
  readonly now: () => number;
  readonly interpretation: () => SocialInterpretation | null;
}
/** One volatile opportunity and at most one linked existing Activity; no scheduler or storage. */
export class CopingRuntime {
  private state = createCopingState();
  private disposed = false;
  constructor(private readonly options: Options) {}
  observed(episode: CausalLifeEpisode, atMs: number): void {
    if (this.disposed || episode.appRunId !== this.options.appRunId() || !Number.isFinite(this.options.now()) || atMs > this.options.now()) return;
    this.state = observeCoping(this.state, episode, this.options.character.getCausalEmotion(), atMs,
      this.options.character.getCausalAffectGeneration());
  }
  consider(gates: { readonly free: boolean; readonly menu: boolean; readonly blocked: boolean }): CopingStrategy | null {
    if (this.disposed) return null;
    const interpretation = this.options.interpretation(), source = this.state.opportunity?.source;
    const status = source && interpretation?.episode.appRunId === source.appRunId && interpretation.episode.sequence === source.sequence
      ? interpretation.status : 'unknown';
    this.state = considerCoping(this.state, { ...this.context(), ...gates, interpretation: status,
      comfort: this.options.character.getState().relationship.comfort });
    return this.state.choice?.strategy ?? null;
  }
  selected(kind: string, factorApplied: boolean): void {
    this.state = selectCoping(this.state, kind, factorApplied);
  }
  activityCommitted(runId: string, activityId: string): void {
    if (!this.disposed) this.state = commitCoping(this.state, runId, activityId, this.context());
  }
  terminal(runId: string, completed: boolean): void {
    if (this.disposed) return;
    const result = finishCoping(this.state, runId, completed, this.context()); this.state = result.state;
    if (result.relief) this.options.character.relieveCausalInterruption(result.relief.sequence, this.options.now(), this.options.character.getCausalAffectGeneration());
  }
  cancel(): void { this.state = cancelCoping(this.state); }
  dispose(): void { this.cancel(); this.disposed = true; }
  private context(): CopingContext {
    return { nowMs: this.options.now(), generation: this.options.character.getCausalAffectGeneration(),
      appRunId: this.options.appRunId(), emotion: this.options.character.getCausalEmotion() };
  }
}
