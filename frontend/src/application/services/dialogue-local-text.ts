/** Technical receipts and statuses; free dialogue remains provider-owned. */
export const LOCAL_DIALOGUE_TEXT = {
  fallback: { ru: 'Сейчас ответ недоступен. Попробуйте позже.', en: 'A reply is unavailable right now. Please try again later.' },
  sleeping: { ru: 'Wisp спит', en: 'Wisp is sleeping' },
  topic_error: { ru: 'Не удалось связать ответ с темой. Обновите тему в памяти и попробуйте снова.', en: 'The reply could not be linked to the topic. Update the topic in memory and try again.' },
  publication_error: { ru: 'Не удалось показать ответ. Попробуй позже.', en: 'The reply could not be displayed. Please try again later.' },
} as const;

export function localDialogueText(key: keyof typeof LOCAL_DIALOGUE_TEXT, locale?: string): string {
  return LOCAL_DIALOGUE_TEXT[key][locale === 'en' ? 'en' : 'ru'];
}
