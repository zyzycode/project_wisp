import type {
  AIProviderSuggestedMood,
  AIProviderTone,
  ProviderSuggestedBehaviorKind,
} from '../../application/ports/ai-provider.interface';

export type MockMessageCategory =
  | 'greeting'
  | 'care'
  | 'play'
  | 'sleep'
  | 'unknown';

export type MockResponseLocale = 'ru' | 'en';

export interface MockResponseTemplate {
  readonly text: string;
  readonly tone: AIProviderTone;
  readonly suggestedMood: AIProviderSuggestedMood;
  readonly suggestedBehavior: ProviderSuggestedBehaviorKind;
  readonly confidence: number;
}

export const UNSUPPORTED_REPLIES = {
  ru: 'На это у меня пока нет подходящего ответа',
  en: "I don't have a suitable reply to that yet.",
} as const;

function withReplies(
  template: MockResponseTemplate,
  ...replies: readonly string[]
): readonly [MockResponseTemplate, ...MockResponseTemplate[]] {
  return [template, ...replies.map((text) => ({ ...template, text }))];
}

export const CATEGORY_TEMPLATES: Readonly<
  Record<
    Exclude<MockMessageCategory, 'unknown'>,
    Readonly<Record<MockResponseLocale, readonly [MockResponseTemplate, ...MockResponseTemplate[]]>>
  >
> = {
  greeting: {
    ru: withReplies({
      text: 'Привет! Я Wisp, твой настольный компаньон. Рада тебя видеть!',
      tone: 'warm',
      suggestedMood: 'happy',
      suggestedBehavior: 'react_happy',
      confidence: 0.95,
    },
      "Привет! Устроюсь рядом, пока ты занимаешься своими делами.",
      "О, привет! Чем займёмся сегодня?",
      "*Радостно мерцает* Привет-привет! Можно к тебе в компанию?",
    ),
    en: withReplies({
      text: 'Hello! Wisp is here and ready to hang out with you!',
      tone: 'playful',
      suggestedMood: 'happy',
      suggestedBehavior: 'react_happy',
      confidence: 0.95,
    },
      "Hey there! Mind if I keep you company?",
      "Hello again! What shall we do today?",
      "*Gives a cheerful little flicker* Hi! Good to see you.",
    ),
  },
  care: {
    ru: withReplies({
      text: '*Мурчит и светится теплее* Спасибо за заботу и тепло!',
      tone: 'warm',
      suggestedMood: 'happy',
      suggestedBehavior: 'react_happy',
      confidence: 0.95,
    },
      "Спасибо! От твоих слов даже искорки становятся теплее.",
      "*Довольно мерцает* Вот это забота! Спасибо тебе.",
      "Как приятно! Посижу рядом и немного посвечусь от радости.",
    ),
    en: withReplies({
      text: '*Glows brightly and snuggles closer* You make me feel safe and happy!',
      tone: 'warm',
      suggestedMood: 'happy',
      suggestedBehavior: 'react_happy',
      confidence: 0.95,
    },
      "Thank you! That deserves a happy little glow.",
      "*Flickers contentedly* A little kindness goes a long way.",
      "Aw, thanks for looking after me!",
    ),
  },
  play: {
    ru: withReplies({
      text: 'Ура, играем! *Радостно кружится и мерцает искорками*',
      tone: 'playful',
      suggestedMood: 'happy',
      suggestedBehavior: 'play',
      confidence: 0.95,
    },
      "Я за! *Весело подпрыгивает* Начинаем?",
      "*Озорно мерцает* У меня как раз настроение для игры!",
      "Давай! Маленькому огоньку тоже нужна порция веселья.",
    ),
    en: withReplies({
      text: 'Yay, play time! *Bounces around cheerfully*',
      tone: 'playful',
      suggestedMood: 'happy',
      suggestedBehavior: 'play',
      confidence: 0.95,
    },
      "Count me in! *Gives an eager little bounce*",
      "Let's play! I've got a few sparks of energy to spare.",
      "*Flickers mischievously* Ready when you are!",
    ),
  },
  sleep: {
    ru: withReplies({
      text: '*Тихо зевает* Кажется, пора немного отдохнуть... Спокойных снов!',
      tone: 'sleepy',
      suggestedMood: 'sleepy',
      suggestedBehavior: 'sleep',
      confidence: 0.95,
    },
      "*Сонно мерцает* Можно немного побыть в тишине. Отдыхай.",
      "Пора прикрыть глазки. Пусть отдых будет спокойным.",
      "*Уютно устраивается* Немного отдыха точно не помешает.",
    ),
    en: withReplies({
      text: '*Yawns softly and dims glow* Getting sleepy... Time to rest.',
      tone: 'sleepy',
      suggestedMood: 'sleepy',
      suggestedBehavior: 'sleep',
      confidence: 0.95,
    },
      "*Flickers sleepily* A quiet break sounds nice.",
      "Time to get cozy and rest for a while.",
      "*Settles down with a tiny yawn* Sweet dreams.",
    ),
  },
};
