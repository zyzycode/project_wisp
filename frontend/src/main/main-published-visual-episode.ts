import type { AnimationIntent } from '../domain/animation/animation-intent';
import type { BrainVisualIntentKindDTO } from '../shared/ipc-contracts';
import type { BrainVisualEpisode } from './main-visual-episode-state';

type VisualIntent = AnimationIntent<BrainVisualIntentKindDTO>;

/** Owns immutable publication identity after Main applies presentation overlays. */
export class MainPublishedVisualEpisode {
  private sequence = 0;
  private source: { readonly id: string; readonly sequence: number; readonly signature: string } | null = null;
  private projectedSignature: string | null = null;
  private published: BrainVisualEpisode | null = null;

  public project(source: BrainVisualEpisode, intent: VisualIntent, capturedAtMs: number): BrainVisualEpisode {
    if (!Number.isSafeInteger(source.sequence) || source.sequence < 1 || !source.id.trim()
      || source.id !== source.id.trim() || !Number.isFinite(source.startedAtMs) || source.startedAtMs < 0
      || !Number.isFinite(capturedAtMs) || capturedAtMs < source.startedAtMs) {
      throw new Error('Invalid source visual episode');
    }
    const sourceSignature = JSON.stringify([source.id, source.sequence, source.startedAtMs,
      source.intent.requestedBy, wireFields(source.intent)]);
    const previous = this.source;
    if (previous && (source.sequence < previous.sequence
      || (source.sequence === previous.sequence && sourceSignature !== previous.signature)
      || (source.sequence > previous.sequence && source.id === previous.id))) {
      throw new Error('Source visual episode was reused, mutated or reversed');
    }
    const sourceChanged = previous === null || source.sequence !== previous.sequence;
    const projectedSignature = wireSignature(intent);
    if (!sourceChanged && projectedSignature === this.projectedSignature && this.published) return this.published;
    if (this.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Published visual episode sequence exhausted');
    const sequence = this.sequence + 1;
    const published: BrainVisualEpisode = {
      id: `${sequence}:published`, sequence,
      startedAtMs: sourceChanged ? source.startedAtMs : capturedAtMs,
      intent: { ...intent },
    };
    this.sequence = sequence;
    this.source = { id: source.id, sequence: source.sequence, signature: sourceSignature };
    this.projectedSignature = projectedSignature;
    this.published = published;
    return published;
  }

  public reset(): void {
    this.sequence = 0;
    this.source = null;
    this.projectedSignature = null;
    this.published = null;
  }
}

/** Match the mapper's wire fields; omitted and explicit undefined hints are equivalent. */
function wireSignature(intent: VisualIntent): string {
  return JSON.stringify(wireFields(intent));
}

function wireFields(intent: VisualIntent) {
  return { kind: intent.kind, category: intent.category, priority: intent.priority, interrupt: intent.interrupt,
    loop: intent.loop, emotionalTone: intent.emotionalTone, expressionHint: intent.expressionHint,
    gazeDirection: intent.gazeDirection, propHint: intent.propHint };
}
