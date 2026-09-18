import type { ICharacterPreferenceLearning } from '../ports/memory-knowledge.interface';
import type { CompletedDialogueMemoryTurn } from '../ports/memory-runtime';
import type { IUserFactsRepository, MemoryFailureCode, MemoryOperationContext } from '../ports/memory-repository.interface';
import { recognizeMemoryFact } from './memory-fact-registry';

export class MemoryKnowledge {
  private readonly observed = new Set<string>();
  constructor(private readonly options: {
    readonly facts: IUserFactsRepository;
    readonly isCurrent: (generation: number) => boolean;
    readonly createId: () => string;
    readonly onFailure: (code: MemoryFailureCode) => void;
    readonly preferenceLearning?: ICharacterPreferenceLearning;
  }) {}
  /** Called within the history queue, only after acknowledgement of both source messages. */
  async persisted(turn: CompletedDialogueMemoryTurn, context: MemoryOperationContext): Promise<void> {
    if (!this.options.isCurrent(context.generation) || this.observed.has(turn.user.id)) return;
    const fact = recognizeMemoryFact(turn.user.text); if (!fact) return;
    this.observed.add(turn.user.id);
    try {
      const result = await this.options.facts.upsert({ id: this.options.createId(), factKey: fact.key, factValue: fact.value,
        confidence: 1, sourceMessageId: turn.user.id, createdAt: turn.user.createdAt, updatedAt: turn.user.createdAt }, context);
      if (!this.options.isCurrent(context.generation)) return;
      if (!result.ok) { this.options.onFailure(result.code); return; }
      if (fact.key === 'user.cursor_game' && (fact.value === 'like' || fact.value === 'dislike')) {
        this.options.preferenceLearning?.observe({ sourceMessageId: turn.user.id, key: 'activity.cursor_game', disposition: fact.value });
      }
    } catch { if (this.options.isCurrent(context.generation)) this.options.onFailure('unavailable'); }
  }
  reset(): void { this.observed.clear(); }
}
