import type { CompletedDialogueMemoryTurn } from '../ports/memory-runtime';
import type { CursorGameResult } from '../ports/cursor-game-contract';
import type { AIProviderContextMessage } from '../ports/ai-provider.interface';
import type { ConversationSession, IChatHistoryRepository, IGameEpisodeRepository, MemoryFailureCode, MemoryOperationContext, MemoryResult } from '../ports/memory-repository.interface';
import { boundMemoryContext } from './memory-context';

export interface MemoryHistoryOptions {
  readonly history: IChatHistoryRepository;
  readonly episodes: IGameEpisodeRepository;
  readonly context: () => MemoryOperationContext | null;
  readonly isCurrent?: (generation: number) => boolean;
  readonly createId: () => string;
  readonly toTimestamp: (monotonicMs: number) => string;
  readonly onFailure: (code: MemoryFailureCode) => void;
}
export class MemoryHistory {
  private appRunId: string;
  private session: ConversationSession | null = null;
  private pendingTurns = 0;
  private turns: Promise<void> = Promise.resolve();
  constructor(private readonly options: MemoryHistoryOptions) { this.appRunId = options.createId(); }
  async hydrate(): Promise<readonly AIProviderContextMessage[]> {
    const c = this.options.context(); if (!c) return [];
    const result = await this.safe(() => this.options.history.getRecent(20, c));
    if (this.options.context()?.generation !== c.generation) return [];
    if (!result.ok) { this.options.onFailure(result.code); return []; }
    return boundMemoryContext(result.value.map(message => ({ role: message.role === 'assistant' ? 'wisp' : 'user', text: message.content, createdAt: message.createdAt })));
  }
  completed(turn: CompletedDialogueMemoryTurn): Promise<void> {
    const context = this.options.context();
    if (!context || context.generation !== turn.memoryGeneration) return Promise.resolve();
    if (this.pendingTurns >= 100) { this.options.onFailure('busy'); return Promise.resolve(); }
    this.pendingTurns++;
    const write = this.turns.then(() => this.appendCompleted(turn, context));
    this.turns = write.finally(() => { this.pendingTurns--; });
    return this.turns;
  }
  private async appendCompleted(turn: CompletedDialogueMemoryTurn, c: MemoryOperationContext): Promise<void> {
    if (!this.isCurrent(c.generation)) return;
    const session = this.session ?? { id: this.options.createId(), appRunId: this.appRunId, startedAt: turn.user.createdAt, endedAt: null };
    const result = await this.safe(() => this.options.history.appendTurn({ session,
      user: { id: turn.user.id, conversationSessionId: session.id, role: 'user', content: turn.user.text, createdAt: turn.user.createdAt },
      assistant: { id: turn.assistant.id, conversationSessionId: session.id, role: 'assistant', content: turn.assistant.text, createdAt: turn.assistant.createdAt } }, c));
    if (!this.isCurrent(c.generation)) return;
    if (result.ok) this.session = session; else this.options.onFailure(result.code);
  }
  async game(result: CursorGameResult, generation: number): Promise<void> {
    const c = this.options.context(); if (!c || c.generation !== generation || !result.playCompleted) return;
    const saved = await this.safe(() => this.options.episodes.append({ appRunId: this.appRunId, activityRunId: result.activityRunId, kind: 'cursor_game', outcome: result.outcome, playCompleted: true, executedMs: result.executedMs, endedAt: this.options.toTimestamp(result.atMs) }, c));
    if (this.options.context()?.generation === generation && !saved.ok) this.options.onFailure(saved.code);
  }
  reset(): void { this.session = null; this.appRunId = this.options.createId(); }
  async close(endedAt: string): Promise<void> {
    const c = this.options.context(); if (!c) return;
    await this.turns;
    if (!this.session || !this.isCurrent(c.generation)) return;
    const result = await this.safe(() => this.options.history.closeSession(this.session!.id, endedAt, c));
    if (this.options.context()?.generation === c.generation && !result.ok) this.options.onFailure(result.code);
  }
  private isCurrent(generation: number): boolean { return this.options.isCurrent?.(generation) ?? this.options.context()?.generation === generation; }
  private async safe<T>(operation: () => Promise<MemoryResult<T>>): Promise<MemoryResult<T>> { try { return await operation(); } catch { return { ok: false, code: 'unavailable' }; } }
}
