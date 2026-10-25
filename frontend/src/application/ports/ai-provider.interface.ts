/**
 * Application Port: AI Provider Interface & DTOs
 * Defines the typed boundary between Project Wisp application layer
 * and semantic response providers (e.g. MockAIProvider, future ExternalAIProviderClient).
 *
 * Rules:
 * - Pure TypeScript interfaces and types only.
 * - No external AI SDK dependencies.
 * - No auth, API keys, tokens, or billing metadata.
 * - No UI/DOM/React/CSS or animation asset details.
 */

import type { CharacterSnapshot } from '../../domain/character/types';
import type { AIProviderMemoryContext, MemoryFactCandidate } from './memory-knowledge.interface';
import type { CharacterCardReference, InteractionAppraisal, PreviousTouchReaction } from './interaction-appraisal';

export type AIProviderStatusKind = 'ready' | 'thinking' | 'degraded' | 'offline' | 'error';

export interface AIProviderStatus {
  kind: AIProviderStatusKind;
  activeRequestId?: string;
  message?: string;
}

export interface AIProviderUserMessage {
  id: string;
  text: string;
  createdAt: string;
}

export type AIProviderCharacterSnapshot = CharacterSnapshot;

export interface AIProviderContextMessage {
  role: 'user' | 'wisp';
  text: string;
  createdAt: string;
}

/** Last committed autonomous speech, in RAM only; never a synthetic user message. */
export interface AIPreviousInitiative {
  readonly kind: 'cursor_game' | 'social_bid';
  readonly text: string;
  readonly createdAt: string;
}

export interface AIProviderRequest {
  /** Explicitly confirmed, source-validated topic; ordinary user dialogue only. */
  readonly dialogueTopic?: import('./interest-thread.interface').AIProviderDialogueTopic;
  /** Full interaction context for the external v1 adapter. */
  readonly interaction?: { readonly card: CharacterCardReference; readonly effectPolicy: 'eligible' | 'suppressed'; readonly previousTouch?: PreviousTouchReaction };
  readonly summary?: { readonly text: string };
  requestId: string;
  userMessage: AIProviderUserMessage;
  characterSnapshot: AIProviderCharacterSnapshot;
  recentContext: AIProviderContextMessage[];
  locale?: string;
  /** Bounded local recall projected into the unified external chat request. */
  readonly memoryContext?: AIProviderMemoryContext;
  /** Captured from the last current-generation published line. */
  readonly previousInitiative?: AIPreviousInitiative;
}

export type AIProviderTone =
  | 'warm'
  | 'playful'
  | 'sleepy'
  | 'curious'
  | 'confused'
  | 'quiet'
  | 'shy'
  | 'affectionate';

export type AIProviderSuggestedMood =
  | 'neutral'
  | 'happy'
  | 'curious'
  | 'sleepy'
  | 'confused'
  | 'shy'
  | 'affectionate';

export type ProviderSuggestedBehaviorKind =
  | 'respond'
  | 'think'
  | 'react_happy'
  | 'react_confused'
  | 'play'
  | 'sleep'
  | 'wake'
  | 'wander'
  | 'idle'
  | 'quiet';

export type AIProviderFallbackReason =
  | 'empty_input'
  | 'message_too_long'
  | 'unsupported_input'
  | 'provider_unavailable'
  | 'timeout'
  | 'unexpected_error';

export interface AIProviderDiagnostics {
  provider: 'mock' | 'external';
  latencyMs: number;
  fallbackReason?: AIProviderFallbackReason;
}

export interface AIProviderReply {
  text: string;
  tone?: AIProviderTone;
}

export type AIProviderResponseStatus = 'ok' | 'fallback';

export interface AIProviderResponse {
  readonly appraisal?: InteractionAppraisal;
  requestId: string;
  status: AIProviderResponseStatus;
  reply: AIProviderReply;
  suggestedMood?: AIProviderSuggestedMood;
  suggestedBehavior?: ProviderSuggestedBehaviorKind;
  confidence: number;
  diagnostics?: AIProviderDiagnostics;
  /** Untrusted proposals; validated/persisted separately after the displayed turn. */
  readonly memoryCandidates?: readonly MemoryFactCandidate[];
}

export interface IAIProvider {
  /** Absent means unsupported. Check capability and ready status before reserving a topic. */
  readonly supportsDialogueTopic?: true;
  /** Whether the final wire projection keeps summary; lets recall restore covered sources when it does not fit. */
  canIncludeSummary?(request: AIProviderRequest): boolean;
  /** Abort a retired request when supported; generation checks still reject late results. */
  cancel?(requestId: string): void;
  getStatus(): Promise<AIProviderStatus>;
  generateResponse(request: AIProviderRequest): Promise<AIProviderResponse>;
}
