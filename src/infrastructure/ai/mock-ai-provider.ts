import type {
  IAIProvider,
  AIProviderRequest,
  AIProviderResponse,
  AIProviderStatus,
  AIProviderTone,
  AIProviderSuggestedMood,
  ProviderSuggestedBehaviorKind,
  AIProviderFallbackReason,
} from '../../application/ports/ai-provider.interface';
import {
  CARE_WORDS,
  CATEGORY_TEMPLATES,
  DEFAULT_FALLBACK_TEMPLATE,
  GREETING_WORDS,
  PLAY_WORDS,
  QUESTION_WORDS,
  SLEEP_WORDS,
} from './mock-response-catalog';
import type {
  MockMessageCategory,
  MockResponseTemplate,
} from './mock-response-catalog';

export type { MockMessageCategory } from './mock-response-catalog';

export interface MockAIProviderOptions {
  /**
   * Simulated response latency in milliseconds.
   * Default is 50ms. Set to 0 for instantaneous responses in tests.
   */
  simulatedLatencyMs?: number;

  /**
   * Maximum allowed input character length before triggering message_too_long fallback.
   * Default is 500 characters.
   */
  maxMessageLength?: number;
}

function containsAnyWord(
  normalizedText: string,
  words: readonly string[]
): boolean {
  for (const word of words) {
    if (word.includes(' ')) {
      if (normalizedText.includes(word)) {
        return true;
      }
    } else {
      const tokens = normalizedText.split(/[\s,.:;!?~`'"()[\]{}<>/\\|+=*&^%$#@!—–-]+/);
      if (tokens.includes(word)) {
        return true;
      }
    }
  }
  return false;
}

export class MockAIProvider implements IAIProvider {
  private status: AIProviderStatus = { kind: 'ready' };
  private readonly simulatedLatencyMs: number;
  private readonly maxMessageLength: number;

  constructor(options: MockAIProviderOptions = {}) {
    this.simulatedLatencyMs = options.simulatedLatencyMs ?? 50;
    this.maxMessageLength = options.maxMessageLength ?? 500;
  }

  public async getStatus(): Promise<AIProviderStatus> {
    return { ...this.status };
  }

  public async generateResponse(request: AIProviderRequest): Promise<AIProviderResponse> {
    const startTime = Date.now();
    this.status = {
      kind: 'thinking',
      activeRequestId: request.requestId,
    };

    try {
      if (this.simulatedLatencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.simulatedLatencyMs));
      }

      const text = request.userMessage.text ?? '';
      const trimmed = text.trim();

      // Empty input fallback
      if (trimmed.length === 0) {
        return this.createFallbackResponse(
          request.requestId,
          'empty_input',
          '...',
          'confused',
          'confused',
          'react_confused',
          Date.now() - startTime
        );
      }

      // Message too long fallback
      if (text.length > this.maxMessageLength) {
        return this.createFallbackResponse(
          request.requestId,
          'message_too_long',
          'Ой, слишком много текста сразу! Можешь сказать чуть короче?',
          'confused',
          'confused',
          'react_confused',
          Date.now() - startTime
        );
      }

      const category = this.detectCategory(trimmed);
      const template = this.pickTemplate(category, request.requestId);

      return {
        requestId: request.requestId,
        status: 'ok',
        reply: {
          text: template.text,
          tone: template.tone,
        },
        suggestedMood: template.suggestedMood,
        suggestedBehavior: template.suggestedBehavior,
        confidence: template.confidence,
        diagnostics: {
          provider: 'mock',
          latencyMs: Date.now() - startTime,
        },
      };
    } finally {
      this.status = { kind: 'ready' };
    }
  }

  public detectCategory(text: string): MockMessageCategory {
    const normalized = text.toLowerCase();

    if (containsAnyWord(normalized, SLEEP_WORDS)) {
      return 'sleep';
    }
    if (containsAnyWord(normalized, PLAY_WORDS)) {
      return 'play';
    }
    if (containsAnyWord(normalized, CARE_WORDS)) {
      return 'care';
    }
    if (containsAnyWord(normalized, GREETING_WORDS)) {
      return 'greeting';
    }
    if (text.includes('?') || containsAnyWord(normalized, QUESTION_WORDS)) {
      return 'question';
    }

    return 'unknown';
  }

  private pickTemplate(category: MockMessageCategory, requestId: string): MockResponseTemplate {
    const templates = CATEGORY_TEMPLATES[category];
    if (!templates || templates.length === 0) {
      return DEFAULT_FALLBACK_TEMPLATE;
    }

    // Deterministic selection based on requestId hash for predictable reproducibility
    let hash = 0;
    for (let i = 0; i < requestId.length; i++) {
      hash = (hash * 31 + requestId.charCodeAt(i)) >>> 0;
    }
    const index = hash % templates.length;
    const selected = templates[index];
    return selected ?? DEFAULT_FALLBACK_TEMPLATE;
  }

  private createFallbackResponse(
    requestId: string,
    fallbackReason: AIProviderFallbackReason,
    replyText: string,
    tone: AIProviderTone,
    suggestedMood: AIProviderSuggestedMood,
    suggestedBehavior: ProviderSuggestedBehaviorKind,
    latencyMs: number
  ): AIProviderResponse {
    return {
      requestId,
      status: 'fallback',
      reply: {
        text: replyText,
        tone,
      },
      suggestedMood,
      suggestedBehavior,
      confidence: 0.3,
      diagnostics: {
        provider: 'mock',
        latencyMs,
        fallbackReason,
      },
    };
  }
}
