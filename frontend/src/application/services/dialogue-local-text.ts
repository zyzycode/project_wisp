/** Technical receipts and statuses; free dialogue remains provider-owned. */
export const LOCAL_DIALOGUE_TEXT = {
  support_quiet_ack: { ru: 'Поняла. Я рядом.', en: "I understand. I'm here." },
  fallback: { ru: 'Сейчас ответ недоступен. Попробуйте позже.', en: 'A reply is unavailable right now. Please try again later.' },
  sleeping: { ru: 'Wisp спит', en: 'Wisp is sleeping' },
  correction_error: { ru: 'Не удалось безопасно исправить предпочтение. Обновите его в памяти и попробуйте снова.', en: 'The preference could not be safely corrected. Update it in memory and try again.' },
  topic_error: { ru: 'Не удалось связать ответ с темой. Обновите тему в памяти и попробуйте снова.', en: 'The reply could not be linked to the topic. Update the topic in memory and try again.' },
  publication_error: { ru: 'Не удалось показать ответ. Попробуй позже.', en: 'The reply could not be displayed. Please try again later.' },
  motion_clarify: { ru: 'Уточни: идти влево, вправо или остановиться?', en: 'Should I walk left, right, or stop?' },
  motion_left: { ru: 'Иду влево.', en: 'Walking left.' },
  motion_right: { ru: 'Иду вправо.', en: 'Walking right.' },
  motion_stopped: { ru: 'Остановилась.', en: 'Stopped.' },
  motion_inactive: { ru: 'Сейчас я не выполняю просьбу о движении.', en: 'I am not following a movement request.' },
  motion_sleeping: { ru: 'Я сплю. Прогулка подождёт.', en: 'I am sleeping. Walking can wait.' },
  motion_low_energy: { ru: 'Я устала, мне нужно отдохнуть.', en: 'I am tired and need to rest.' },
  motion_overloaded: { ru: 'Движение недоступно из-за перегрузки.', en: 'Movement is unavailable due to overload.' },
  motion_forced_motion: { ru: 'Сейчас не могу идти: сначала нужно закончить текущее движение.', en: 'I cannot walk until the current movement finishes.' },
  motion_unavailable: { ru: 'Сейчас движение недоступно.', en: 'Movement is unavailable right now.' },
  motion_no_support: { ru: 'Сейчас нет подходящей опоры для прогулки.', en: 'There is no suitable support for walking right now.' },
  motion_edge: { ru: 'В эту сторону дальше идти некуда.', en: 'There is no room to walk that way.' },
  motion_completed: { ru: 'Закончила прогулку.', en: 'Finished walking.' },
  motion_critical_need: { ru: 'Остановилась: мне нужно отдохнуть.', en: 'I stopped to rest.' },
  motion_cancel_stop: { ru: 'Просьба о движении остановлена.', en: 'The movement request was stopped.' },
  motion_cancel_replaced: { ru: 'Просьба о движении заменена новой.', en: 'The movement request was replaced by a new request.' },
  motion_cancel_user_input: { ru: 'Просьба о движении отменена после нового сообщения.', en: 'The movement request was cancelled after a new message.' },
  motion_cancel_forced_motion: { ru: 'Прогулка прервана другим движением.', en: 'Walking was interrupted by another movement.' },
  motion_cancel_environment_changed: { ru: 'Прогулка отменена: условия движения изменились.', en: 'Walking was cancelled because movement conditions changed.' },
  motion_cancel_reset: { ru: 'Просьба о движении отменена после сброса.', en: 'The movement request was cancelled after reset.' },
  motion_cancel_disposed: { ru: 'Просьба о движении отменена при завершении работы.', en: 'The movement request was cancelled during shutdown.' },
  motion_cancel_timeout: { ru: 'Прогулка остановлена: время выполнения истекло.', en: 'Walking stopped because its time limit expired.' },
} as const;

export function localDialogueText(key: keyof typeof LOCAL_DIALOGUE_TEXT, locale?: string): string {
  return LOCAL_DIALOGUE_TEXT[key][locale === 'en' ? 'en' : 'ru'];
}
