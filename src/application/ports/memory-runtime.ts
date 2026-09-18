import type { AIProviderContextMessage } from './ai-provider.interface';
import type { ChatContextLimits } from './memory-repository.interface';

export interface CompletedDialogueMemoryTurn {
  readonly user: { readonly id: string; readonly text: string; readonly createdAt: string };
  readonly assistant: { readonly id: string; readonly text: string; readonly createdAt: string };
  readonly memoryGeneration: number;
}
export interface DialogueMemoryHooks {
  readonly generation: () => number;
  readonly recall?: import('./memory-knowledge.interface').ILocalMemoryRecall;
  readonly completed: (turn: CompletedDialogueMemoryTurn) => void;
  /** Present only for the local Mock; network providers retain their six-message policy. */
  readonly contextLimits?: ChatContextLimits;
}
export interface MemoryScheduler {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}
export interface InitialDialogueContext { readonly messages: readonly AIProviderContextMessage[] }

export interface MemoryRepositories {
  readonly history: import('./memory-repository.interface').IChatHistoryRepository;
  readonly facts: import('./memory-repository.interface').IUserFactsRepository;
  readonly episodes: import('./memory-repository.interface').IGameEpisodeRepository;
  readonly character: import('./memory-repository.interface').ICharacterStateRepository;
  readonly clear: import('./memory-repository.interface').IClearMemoryStore;
  readonly ready: Promise<import('./memory-repository.interface').MemoryResult<void>>;
  close(generation: number): Promise<void>;
  abort(): Promise<void>;
}
