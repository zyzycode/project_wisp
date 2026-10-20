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

export type MockResponseLocale = 'ru' | 'en';

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

function withReplies(
  template: MockResponseTemplate,
  ...replies: readonly string[]
): readonly [MockResponseTemplate, ...MockResponseTemplate[]] {
  return [template, ...replies.map((text) => ({ ...template, text }))];
}

export const CATEGORY_TEMPLATES: Readonly<
  Record<
    MockMessageCategory,
    Readonly<Record<MockResponseLocale, readonly [MockResponseTemplate, ...MockResponseTemplate[]]>>
  >
> = {
  greeting: {
    ru: withReplies({
      text: 'Привет! Я Wisp, твой настольный компаньон. Рад тебя видеть!',
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
  question: {
    ru: withReplies({
      text: 'Интересный вопрос! Я пока маленький огонёк, но внимательно тебя слушаю.',
      tone: 'curious',
      suggestedMood: 'curious',
      suggestedBehavior: 'respond',
      confidence: 0.9,
    },
      "Не уверен в ответе. Расскажешь, что тебя заинтересовало?",
      "Хм, тут я могу только задумчиво померцать. А ты что думаешь?",
      "Боюсь, точного ответа у меня нет. Но послушать твою версию интересно!",
    ),
    en: withReplies({
      text: "That's an intriguing thought! Let me think about it with you.",
      tone: 'curious',
      suggestedMood: 'curious',
      suggestedBehavior: 'respond',
      confidence: 0.9,
    },
      "I'm not sure of the answer. What got you curious?",
      "Hmm, that one has me puzzled. What do you think?",
      "I don't have a reliable answer, but I'd like to hear your thoughts.",
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
  unknown: {
    ru: withReplies(DEFAULT_FALLBACK_TEMPLATE,
      "Я рядом. Можешь рассказать чуть подробнее?",
      "*Тихонько мерцает* Продолжай, я слушаю.",
      "Не всё понимаю, но мне приятно составить тебе компанию.",
      "Можем просто немного поболтать. О чём тебе хочется?",
      "*Устраивается поудобнее* А что у тебя сейчас на уме?",
      "Иногда я теряюсь в словах. Попробуешь сказать по-другому?",
      "Побуду здесь маленьким огоньком для компании.",
    ),
    en: withReplies({
      text: "*Flickers warmly* I'm still learning, but I love spending time with you!",
      tone: 'warm',
      suggestedMood: 'neutral',
      suggestedBehavior: 'respond',
      confidence: 0.7,
    },
      "I'm here. Want to tell me a little more?",
      "*Flickers softly* Go on, I am listening.",
      "I may not understand everything, but I'm glad to keep you company.",
      "We can just chat for a bit. What would you like to talk about?",
      "*Settles in comfortably* What is on your mind?",
      "I get a little lost with words sometimes. Could you put that another way?",
      "I'll be a little glow here to keep you company.",
    ),
  },
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
