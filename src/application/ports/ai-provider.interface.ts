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

export interface AIProviderRequest {
  requestId: string;
  userMessage: AIProviderUserMessage;
  characterSnapshot: AIProviderCharacterSnapshot;
  recentContext: AIProviderContextMessage[];
  locale?: string;
  /** Explicit memory-capable provider mode only; never silently added to wire v1. */
  readonly memoryContext?: AIProviderMemoryContext;
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
  getStatus(): Promise<AIProviderStatus>;
  generateResponse(request: AIProviderRequest): Promise<AIProviderResponse>;
}
