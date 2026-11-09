import { useEffect, useSyncExternalStore } from 'react';
import type { RoutineHypothesisBridge } from '../../../shared/routine-hypothesis-contracts';
import { getRoutineHypothesisClient } from '../../routine-hypothesis-client';
export function RoutineHypothesisSettings({ bridge,streamId,disabled = false,refreshKey }: {
  readonly bridge: RoutineHypothesisBridge;
  readonly streamId: string | null;
  readonly disabled?: boolean;
  readonly refreshKey?: string | number | null;
}) {
  const client = getRoutineHypothesisClient(bridge);
  const state = useSyncExternalStore(client.subscribe,client.getState,client.getState);
  useEffect(() => { client.acceptStream(streamId); void client.read(); },[client,streamId,refreshKey]);
  useEffect(() => {
    const refresh = () => { void client.read(); };
    window.addEventListener('focus',refresh);
    return () => window.removeEventListener('focus',refresh);
  },[client]);
  const value = state.value, counts = value?.counts;
  return <fieldset className="summary-source-fields" disabled={disabled || state.busy || !streamId} aria-label="Гипотеза распорядка">
    <legend>Гипотеза распорядка</legend>
    <p>Только при работающей Wisp. Это осторожный вывод о повторяемости системной активности, а не сведения о сне или работе.</p>
    {value && <>
      <p>Текущее окно: {String(value.windowStartHour).padStart(2,'0')}:00–{String(value.windowStartHour + 6).padStart(2,'0')}:00.</p>
      {counts && <p>Подходящих дней: {counts.eligibleDays} из 28. С активностью не менее часа: {counts.positiveDays}; среди последних семи подходящих — {counts.recentPositiveDays}.
        {counts.observedThroughDate && <> Последний подходящий день: <time dateTime={counts.observedThroughDate}>{counts.observedThroughDate}</time>.</>}</p>}
      <p role="status">{!value.available ? 'Источник или локальное чтение сейчас недоступны.' : value.suppressed ? 'Этот вывод отозван для текущего окна.' : counts?.qualifies ? 'Данных достаточно для условной гипотезы.' : 'Данных пока недостаточно для гипотезы. Пропуски не считаются неактивностью.'}</p>
      {!value.backendAvailable && <p>AI-соединение сейчас недоступно. Локальная запись продолжается.</p>}
      <label className="summary-source-option"><input type="checkbox" checked={value.sharing} onChange={event => { void client.share(event.currentTarget.checked); }} /> Передавать гипотезу распорядка в обычный AI-диалог</label>
      <p>Следующий обычный запрос может передать только окно, количество дней и дату наблюдения локальному серверу и AI-провайдеру. Сырые наблюдения и часовой пояс не передаются. Согласие действует в этой сессии и снимается при перезагрузке, блокировке или сне устройства. Уже переданные данные локальный отзыв не удаляет.</p>
      <button type="button" onClick={() => { void client.suppress(value.windowStartHour,!value.suppressed); }}>{value.suppressed ? 'Разрешить снова' : 'Не использовать этот вывод'}</button>
      <p>Отзыв сохраняется для этого шестичасового окна до явного разрешения или полной очистки памяти. Он не останавливает локальную запись.</p>
    </>}
    {!value && <p role="status">{state.busy ? 'Проверяем локальные наблюдения…' : 'Обновите проверку, чтобы увидеть доступность гипотезы и настройки.'}</p>}
    {state.message && <p role="status">{state.message}</p>}
    <button type="button" onClick={() => { void client.read(); }}>Обновить гипотезу</button>
  </fieldset>;
}
