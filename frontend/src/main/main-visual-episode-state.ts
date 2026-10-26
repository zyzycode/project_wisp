import { createSystemAnimationIntent, type AnimationIntent } from '../domain/animation/animation-intent';
import type { BrainVisualIntentKindDTO } from '../shared/ipc-contracts';

export interface BrainVisualEpisode {
  readonly id: string;
  readonly sequence: number;
  readonly startedAtMs: number;
  readonly intent: AnimationIntent<BrainVisualIntentKindDTO>;
}

/** Owns presentation identity; the composition retains publication and semantic decisions. */
export class MainVisualEpisodeState {
  private sequence = 0;
  private episode: BrainVisualEpisode;
  public constructor(private readonly options: {
    readonly now: () => number;
    readonly tone: () => AnimationIntent['emotionalTone'];
    readonly createId: () => string;
  }) {
    this.episode = this.create('idle_blink');
  }

  public get current(): BrainVisualEpisode { return this.episode; }

  public set(source: BrainVisualIntentKindDTO | AnimationIntent<BrainVisualIntentKindDTO>, replay: boolean): boolean {
    const kind = typeof source === 'string' ? source : source.kind;
    if (!replay && this.episode.intent.kind === kind) return false;
    this.episode = this.create(source);
    return true;
  }

  private create(source: BrainVisualIntentKindDTO | AnimationIntent<BrainVisualIntentKindDTO>): BrainVisualEpisode {
    const rawId = this.options.createId();
    if (rawId.trim().length === 0 || rawId.trim() !== rawId) throw new Error('Visual episode ID must be trimmed and non-empty');
    if (this.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Visual episode sequence exhausted');
    const sequence = ++this.sequence;
    const id = `${sequence}:${rawId.slice(0, 100).trimEnd()}`;
    const intent = typeof source === 'string' ? createSystemAnimationIntent(source, this.options.tone()) : source;
    return { id, sequence, startedAtMs: this.options.now(), intent: { ...intent } };
  }
}
