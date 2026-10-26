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
import { CATEGORY_TEMPLATES, UNSUPPORTED_REPLIES } from './mock-response-catalog';
import type {
  MockMessageCategory,
  MockResponseTemplate,
  MockResponseLocale,
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

// Whole utterances form a deliberately small local command grammar, not an NLP classifier.
const SCENARIOS: ReadonlyArray<readonly [Exclude<MockMessageCategory, 'unknown'>, RegExp]> = [
  ['greeting', /^(?:привет|здравствуй|здравствуйте|хай|добрый день|добрый вечер|доброе утро|салют)(?: (?:wisp|маленький огонек|маленький огонёк))?$/u],
  ['greeting', /^(?:hi|hello|hey|greetings|howdy)(?: (?:wisp|friend|partner))?$/u],
  ['play', /^(?:(?:давай|давайте) )?(?:играть|поиграем|поиграй)(?: вместе| со мной| в мячик)?$/u],
  ['play', /^можешь поиграть(?: со мной| вместе)?$/u],
  ['play', /^(?:(?:let's|let us|please) )?play(?: with me| together)?$/u],
  ['sleep', /^(?:спать|иди спать|отдохни|засыпай)$/u],
  ['sleep', /^(?:sleep|go to sleep|take a nap|rest|please rest)$/u],
  ['care', /^(?:хочу тебя (?:погладить|обнять)|люблю тебя|ты умница(?: вот тебе печенька)?)$/u],
  ['care', /^(?:i (?:want to hug you|love you)|you are (?:lovely|great)|you're (?:lovely|great))$/u],
];

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
      const locale = request.locale === 'en' ? 'en' : 'ru';

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
          locale === 'en'
            ? 'Oh, that is a lot of text at once! Could you say it a little shorter?'
            : 'Ой, слишком много текста сразу! Можешь сказать чуть короче?',
          'confused',
          'confused',
          'react_confused',
          Date.now() - startTime
        );
      }

      const category = this.detectCategory(trimmed);
      const template = category === 'unknown' ? undefined
        : this.pickTemplate(category, request.requestId, locale, request.characterSnapshot.synthesizedTone);
      if (!template) {
        return this.createFallbackResponse(request.requestId, 'unsupported_input', UNSUPPORTED_REPLIES[locale],
          'quiet', 'neutral', 'respond', Date.now() - startTime);
      }

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
    // Quotes are not command wrappers: a mentioned command must not launch an action.
    if (/["“”«»]/u.test(text)) return 'unknown';
    const normalized = text.toLowerCase().trim().replace(/[,]/gu, ' ').replace(/\s+/gu, ' ')
      .replace(/[.!?]+$/u, '').trim();
    const greeting = normalized.replace(/[.!?\s\p{Extended_Pictographic}\uFE0F]+$/u, '').trim();
    for (const [category, pattern] of SCENARIOS) {
      if (pattern.test(category === 'greeting' ? greeting : normalized)) return category;
    }
    return 'unknown';
  }

  private pickTemplate(
    category: Exclude<MockMessageCategory, 'unknown'>,
    requestId: string,
    locale: MockResponseLocale,
    tone: AIProviderRequest['characterSnapshot']['synthesizedTone']
  ): MockResponseTemplate | undefined {
    const templates = CATEGORY_TEMPLATES[category][locale];
    // Never relabel an eager action as sleepy/shy. No compatible authored play line exists.
    if (category === 'play' && (tone === 'sleepy' || tone === 'shy' || tone === 'flustered')) return undefined;
    if ((category === 'greeting' || category === 'care') && tone !== 'neutral') {
      // These existing variants contain no energetic or intimate stage directions.
      const selected = templates[1];
      if (!selected) return undefined;
      if (tone === 'sleepy' || tone === 'shy' || tone === 'affectionate') {
        return { ...selected, tone, suggestedMood: tone, suggestedBehavior: 'respond' };
      }
      if (tone === 'playful' || tone === 'curious') {
        return { ...selected, tone, suggestedMood: tone === 'curious' ? 'curious' : 'happy' };
      }
      return undefined;
    }

    // Deterministic selection based on requestId hash for predictable reproducibility
    let hash = 0;
    for (let i = 0; i < requestId.length; i++) {
      hash = (hash * 31 + requestId.charCodeAt(i)) >>> 0;
    }
    const index = hash % templates.length;
    const selected = templates[index];
    return selected ?? templates[0];
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
