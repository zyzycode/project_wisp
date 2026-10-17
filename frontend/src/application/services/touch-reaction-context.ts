import type { CharacterStateService, TouchInteractionReceipt } from './character-state.service';
import type { InteractionAppraisal, PreviousTouchReaction } from '../ports/interaction-appraisal';
import { exactRecord, enumValue } from '../../shared/dialogue-ipc-validation';

export const NEUTRAL_TOUCH_APPRAISAL: InteractionAppraisal = { category: 'neutral', intensity: 'low', confidence: 'uncertain' };
export function parseInteractionAppraisal(value: unknown, touch = false): InteractionAppraisal {
  const r = exactRecord(value, ['category', 'intensity', 'confidence']);
  const result = { category: enumValue(r.category, ['supportive', 'playful', 'boundary', 'hostile', 'neutral']),
    intensity: enumValue(r.intensity, ['low', 'moderate']), confidence: enumValue(r.confidence, ['clear', 'uncertain']) };
  if (touch && (result.category === 'hostile' || result.intensity !== 'low')) throw new TypeError('Invalid touch appraisal');
  return result;
}
export class TouchReactionContext {
  private trace: { readonly value: PreviousTouchReaction; readonly expiresAt: number } | null = null;
  constructor(private readonly character: Pick<CharacterStateService, 'commitTouch'>, private readonly now: () => number) {}
  clear(): void { this.trace = null; }
  get(): PreviousTouchReaction | undefined {
    if (!this.trace || this.now() >= this.trace.expiresAt) { this.trace = null; return undefined; }
    return { ...this.trace.value, appraisal: { ...this.trace.value.appraisal } };
  }
  publish(receipt: TouchInteractionReceipt, occurredAt: string, text: string | undefined, proposal: InteractionAppraisal | undefined, locale: 'ru' | 'en'): string {
    const outcome = this.character.commitTouch(receipt, proposal);
    const fallback = !text || !proposal || outcome.effect === 'rejected' || outcome.effect === 'suppressed';
    const publishedText = fallback ? locale === 'ru' ? 'Я заметила касание.' : 'I noticed your touch.' : text;
    this.trace = { value: { action: 'touch', occurredAt, publishedText, appraisal: fallback ? NEUTRAL_TOUCH_APPRAISAL : proposal,
      ...outcome, energyBand: receipt.energyBand, comfortBand: receipt.comfortBand }, expiresAt: this.now() + 600000 };
    return publishedText;
  }
}
