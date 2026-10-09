export const INTERACTION_REPLIES = {
  welcome: 'Привет! Я Wisp ✨',
  wake: 'Доброе утро! ☀️',
  sleep: 'Zzz... 🌙',
  pet: 'Люблю, когда гладят! 💖',
  play: 'Давай играть! Догони меня! 🎮',
  feed: 'Спасибо за угощение! Вкусно! 🍪',
  think: 'Хм-м, о чём бы поразмышлять?.. 🤔',
  spook: 'Ой! 😲',
  wave: 'Привет-привет! 🖐️',
  celebrate: 'Ура-а! Празднуем! 🎉',
  bored: 'Эх, скучновато... 🥱',
} as const;

export const FACE_PREVIEW_REPLIES: Readonly<Record<string, string>> = {
  happy: 'Улыбаюсь! 😊',
  sad: 'Мне немного грустно... 🥺',
  shocked: 'Ого, ничего себе! 😲',
  sleepy: 'Глазки слипаются... 😴',
  talking: 'Что-то рассказываю! 💬',
  thinking: 'Хм, интересно... 🤔',
  angry: 'Я сержусь! 😠',
};

export const FACE_PREVIEW_FALLBACK_PREFIX = 'Выражение: ';
export const FACE_PREVIEW_DEFAULT_REPLY = 'Обычное выражение ✨';
