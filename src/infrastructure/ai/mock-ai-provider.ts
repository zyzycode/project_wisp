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

export type MockMessageCategory =
  | 'greeting'
  | 'question'
  | 'care'
  | 'play'
  | 'sleep'
  | 'unknown';

interface MockResponseTemplate {
  text: string;
  tone: AIProviderTone;
  suggestedMood: AIProviderSuggestedMood;
  suggestedBehavior: ProviderSuggestedBehaviorKind;
  confidence: number;
}

const DEFAULT_FALLBACK_TEMPLATE: MockResponseTemplate = {
  text: '*Мерцает мягким светом* Я пока не всё знаю, но всегда рядом с тобой!',
  tone: 'curious',
  suggestedMood: 'curious',
  suggestedBehavior: 'respond',
  confidence: 0.7,
};

const CATEGORY_TEMPLATES: Record<MockMessageCategory, MockResponseTemplate[]> = {
  greeting: [
    {
      text: 'Привет! Я Wisp, твой настольный компаньон. Рад тебя видеть!',
      tone: 'warm',
      suggestedMood: 'happy',
      suggestedBehavior: 'react_happy',
      confidence: 0.95,
    },
    {
      text: 'Hello! Wisp is here and ready to hang out with you!',
      tone: 'playful',
      suggestedMood: 'happy',
      suggestedBehavior: 'react_happy',
      confidence: 0.95,
    },
  ],
  question: [
    {
      text: 'Интересный вопрос! Я пока маленький огонёк, но внимательно тебя слушаю.',
      tone: 'curious',
      suggestedMood: 'curious',
      suggestedBehavior: 'respond',
      confidence: 0.9,
    },
    {
      text: "That's an intriguing thought! Let me think about it with you.",
      tone: 'curious',
      suggestedMood: 'curious',
      suggestedBehavior: 'respond',
      confidence: 0.9,
    },
  ],
  care: [
    {
      text: '*Мурчит и светится теплее* Спасибо за заботу и тепло!',
      tone: 'warm',
      suggestedMood: 'happy',
      suggestedBehavior: 'react_happy',
      confidence: 0.95,
    },
    {
      text: '*Glows brightly and snuggles closer* You make me feel safe and happy!',
      tone: 'warm',
      suggestedMood: 'happy',
      suggestedBehavior: 'react_happy',
      confidence: 0.95,
    },
  ],
  play: [
    {
      text: 'Ура, играем! *Радостно кружится и мерцает искорками*',
      tone: 'playful',
      suggestedMood: 'happy',
      suggestedBehavior: 'play',
      confidence: 0.95,
    },
    {
      text: 'Yay, play time! *Bounces around cheerfully*',
      tone: 'playful',
      suggestedMood: 'happy',
      suggestedBehavior: 'play',
      confidence: 0.95,
    },
  ],
  sleep: [
    {
      text: '*Тихо зевает* Кажется, пора немного отдохнуть... Спокойных снов!',
      tone: 'sleepy',
      suggestedMood: 'sleepy',
      suggestedBehavior: 'sleep',
      confidence: 0.95,
    },
    {
      text: '*Yawns softly and dims glow* Getting sleepy... Time to rest.',
      tone: 'sleepy',
      suggestedMood: 'sleepy',
      suggestedBehavior: 'sleep',
      confidence: 0.95,
    },
  ],
  unknown: [
    DEFAULT_FALLBACK_TEMPLATE,
    {
      text: "*Flickers warmly* I'm still learning, but I love spending time with you!",
      tone: 'warm',
      suggestedMood: 'neutral',
      suggestedBehavior: 'respond',
      confidence: 0.7,
    },
  ],
};

const GREETING_WORDS = [
  'hi',
  'hello',
  'hey',
  'greetings',
  'howdy',
  'привет',
  'здравствуй',
  'здравствуйте',
  'хай',
  'добрый день',
  'добрый вечер',
  'доброе утро',
  'салют',
];

const SLEEP_WORDS = [
  'sleep',
  'nap',
  'bed',
  'tired',
  'goodnight',
  'night',
  'спать',
  'дремать',
  'устал',
  'устала',
  'спокойной ночи',
  'баиньки',
  'отдыхать',
  'отдохни',
  'засыпай',
];

const PLAY_WORDS = [
  'play',
  'game',
  'jump',
  'dance',
  'fun',
  'играть',
  'поиграем',
  'прыгай',
  'танцуй',
  'лови',
  'веселье',
  'мячик',
  'поиграй',
];

const CARE_WORDS = [
  'pet',
  'pat',
  'hug',
  'love',
  'care',
  'snuggle',
  'feed',
  'cookie',
  'погладить',
  'гладить',
  'обнять',
  'люблю',
  'хороший',
  'умница',
  'кушать',
  'покормить',
  'печенька',
  'почесать',
];

const QUESTION_WORDS = [
  'why',
  'what',
  'how',
  'who',
  'where',
  'when',
  'почему',
  'что',
  'как',
  'кто',
  'где',
  'когда',
  'зачем',
];

function containsAnyWord(normalizedText: string, words: string[]): boolean {
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
