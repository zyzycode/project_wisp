import type {
  AIProviderSuggestedMood,
  AIProviderTone,
  ProviderSuggestedBehaviorKind,
} from '../../application/ports/ai-provider.interface';

export type MockMessageCategory =
  | 'greeting'
  | 'question'
  | 'care'
  | 'play'
  | 'sleep'
  | 'unknown';

export interface MockResponseTemplate {
  readonly text: string;
  readonly tone: AIProviderTone;
  readonly suggestedMood: AIProviderSuggestedMood;
  readonly suggestedBehavior: ProviderSuggestedBehaviorKind;
  readonly confidence: number;
}

export const DEFAULT_FALLBACK_TEMPLATE = {
  text: '*Мерцает мягким светом* Я пока не всё знаю, но всегда рядом с тобой!',
  tone: 'curious',
  suggestedMood: 'curious',
  suggestedBehavior: 'respond',
  confidence: 0.7,
} as const satisfies MockResponseTemplate;

export const CATEGORY_TEMPLATES: Readonly<
  Record<MockMessageCategory, readonly MockResponseTemplate[]>
> = {
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

export const GREETING_WORDS = [
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
] as const;

export const SLEEP_WORDS = [
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
] as const;

export const PLAY_WORDS = [
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
] as const;

export const CARE_WORDS = [
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
] as const;

export const QUESTION_WORDS = [
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
] as const;
