import type { LocalMemoryFactKey, MemoryFactCandidate, MemoryFactKey } from '../ports/memory-knowledge.interface';
import { enumValue, exactRecord, plainText } from '../../shared/dialogue-ipc-validation';

export const MEMORY_FACT_KEYS = ['user.display_name', 'user.preferred_address', 'user.favorite_topic', 'user.reply_style', 'user.cursor_game'] as const;
export function parseMemoryFact(value: unknown): { readonly key: MemoryFactKey; readonly value: string } {
  const r = exactRecord(value, ['key', 'value']);
  const key = enumValue(r.key, MEMORY_FACT_KEYS);
  const text = plainText(r.value, key === 'user.favorite_topic' ? 120 : 80, true);
  if (key === 'user.reply_style') enumValue(text, ['brief', 'detailed']);
  if (key === 'user.cursor_game') enumValue(text, ['like', 'dislike']);
  return { key, value: text };
}
/** Deliberately narrow whole-message grammar. No model, inference or source rewriting. */
export function recognizeMemoryFact(input: string): { readonly key: LocalMemoryFactKey; readonly value: string } | undefined {
  const text = input.trim().normalize('NFC').replace(/^(?:Запомни|Remember|Исправление|Correction): /iu, '').replace(/\.$/u, '');
  const captures: readonly [MemoryFactKey, RegExp][] = [
    ['user.display_name', /^(?:Меня зовут|My name is) ([\p{L} -]+)$/iu],
    ['user.preferred_address', /^(?:Называй меня|Call me) ([\p{L} -]+)$/iu],
    ['user.favorite_topic', /^(?:Моя любимая тема —|My favorite topic is) ([\p{L}\p{N} '-]+)$/iu],
  ];
  for (const [key, pattern] of captures) {
    const match = pattern.exec(text);
    if (match && !match[1]?.startsWith("'") && !match[1]?.endsWith("'")) {
      if (/^(?:не|not)(?:\s|$)|(?:^|\s)(?:если|if|но|but)(?:\s|$)/iu.test(match[1] ?? '')) return undefined;
      try { return parseMemoryFact({ key, value: match[1] }); } catch { return undefined; } }
  }
  for (const [key, value, pattern] of [
    ['user.reply_style', 'brief', /^(?:Я предпочитаю короткие ответы|Всегда отвечай кратко|I prefer short replies|Always keep replies brief)$/iu],
    ['user.reply_style', 'detailed', /^(?:Я предпочитаю подробные ответы|Всегда отвечай подробно|I prefer detailed replies|Always give detailed replies)$/iu],
    ['user.cursor_game', 'like', /^(?:Мне нравится игра с курсором|I like the cursor game)$/iu],
    ['user.cursor_game', 'dislike', /^(?:Мне не нравится игра с курсором|I dislike the cursor game)$/iu],
    ['user.explore', 'like', /^(?:Мне нравятся твои прогулки|I like your walks)$/iu],
    ['user.explore', 'dislike', /^(?:Мне не нравятся твои прогулки|I dislike your walks)$/iu],
    ['user.social_bid', 'like', /^(?:Мне нравятся твои инициативы общения|I like your social initiatives)$/iu],
    ['user.social_bid', 'dislike', /^(?:Мне не нравятся твои инициативы общения|I dislike your social initiatives)$/iu],
  ] as const) if (pattern.test(text)) return { key, value };
  return undefined;
}
/** Invalid optional proposals never discard a valid reply. Duplicate keys all disappear. */
export function parseMemoryCandidates(value: unknown, userText?: string): readonly MemoryFactCandidate[] | undefined {
  if (!Array.isArray(value) || value.length > 3) return undefined;
  const keys = value.map(item => {
    try { const property = item && typeof item === 'object' ? Object.getOwnPropertyDescriptor(item, 'key') : undefined; return property && 'value' in property ? property.value : undefined; } catch { return undefined; }
  });
  return value.flatMap((item, index) => {
    try {
      const r = exactRecord(item, ['key', 'value', 'evidenceQuote']);
      if (keys.some((key, other) => other !== index && key === r.key)) return [];
      const fact = parseMemoryFact({ key: r.key, value: r.value });
      const evidenceQuote = plainText(r.evidenceQuote, 240);
      if (userText !== undefined && evidenceQuote !== userText.trim()) return [];
      return [{ ...fact, evidenceQuote }];
    } catch { return []; }
  });
}

/** Topic evidence must not reuse a command whose facts/preferences may already be learned. */
export function isInterestThreadSourceText(input: string): boolean {
  return !recognizeMemoryFact(input) && !/^(?:забудь|forget|на время|временно|temporarily|pretend|представь|теперь ты|you are now)(?:\s|$|[:,.!?])/iu.test(input.trim());
}
