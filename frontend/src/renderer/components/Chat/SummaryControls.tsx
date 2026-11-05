import { useEffect, useState, useSyncExternalStore } from 'react';
import type { BrainStateDTO, SummaryApiBridge } from '../../../shared/ipc-contracts';
import { getSummaryClient } from '../../summary-client';
interface Props { readonly visible?: boolean; readonly bridge: SummaryApiBridge; readonly snapshot: Pick<BrainStateDTO, 'streamId' | 'dialogue'> | null }
const outcome = { completed: 'Завершена', cancelled: 'Прервана', failed: 'Не завершена' };
const participation = { user_engaged: 'с участием пользователя', solitary: 'самостоятельно', none: 'участие не записано' };
const actor = { user: 'пользователь', system: 'система', autonomy: 'Wisp', unknown: 'не записан' };
const cause = { completed: 'завершение', user_interrupted: 'действие пользователя', environment_lost: 'потеря окружения', timeout: 'истекло время' };
export function SummaryControls({ bridge, snapshot, visible = true }: Props) {
  const client = getSummaryClient(bridge);
  const state = useSyncExternalStore(client.subscribe, client.getState, client.getState);
  const [mode, setMode] = useState<'dialogue_pairs' | 'life_events'>(() => state.preview && 'events' in state.preview ? 'life_events' : 'dialogue_pairs');
  const [throughDateUTC, setThrough] = useState(() => state.preview && 'events' in state.preview ? state.preview.throughDateUTC : new Date().toISOString().slice(0, 10));
  const [fromDateUTC, setFrom] = useState(() => state.preview && 'events' in state.preview ? state.preview.fromDateUTC : new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10));
  useEffect(() => client.acceptIdentity(snapshot?.streamId ?? null, snapshot?.dialogue.conversationId ?? null), [client, snapshot?.streamId, snapshot?.dialogue.conversationId]);
  if (!visible) return null;
  const disabled = state.busy || !snapshot;
  const span = (Date.parse(throughDateUTC) - Date.parse(fromDateUTC)) / 86400000 + 1;
  const invalidRange = mode === 'life_events' && (!Number.isFinite(span) || span < 1 || span > 14);
  const life = state.preview && 'events' in state.preview ? state.preview : null;
  return <section aria-label="Краткое содержание">
    <fieldset className="summary-source-fields" disabled={disabled}>
      <legend>Источники краткого содержания</legend>
      <label className="summary-source-option"><input type="radio" name="summary-source" checked={mode === 'dialogue_pairs'} onChange={() => { client.cancelPreview(); setMode('dialogue_pairs'); }} /> Переписка</label>
      <label className="summary-source-option"><input type="radio" name="summary-source" checked={mode === 'life_events'} onChange={() => { client.cancelPreview(); setMode('life_events'); }} /> События Wisp</label>
      {mode === 'life_events' && <div>
        <p>Выберите от 1 до 14 календарных дат UTC. В просмотр попадут последние 4–8 подходящих игр этого периода. Он недоступен, пока история восстанавливается, часы недостоверны или событий недостаточно.</p>
        <label>С даты (UTC) <input type="date" value={fromDateUTC} max={throughDateUTC} onChange={e => { client.cancelPreview(); setFrom(e.target.value); }} /></label>
        <label>По дату (UTC), включительно <input type="date" value={throughDateUTC} min={fromDateUTC} max={new Date().toISOString().slice(0, 10)} onChange={e => { client.cancelPreview(); setThrough(e.target.value); }} /></label>
        {invalidRange && <p role="status">Укажите корректный период длиной не более 14 дат.</p>}
      </div>}
    </fieldset>
    {mode === 'dialogue_pairs' && <p>Для краткого содержания нужны включённый сервис и не менее четырёх подходящих пар сообщений.</p>}
    {!snapshot && <p role="status">Ожидаем подключение к диалогу…</p>}
    {state.busy && <p role="status">Выполняется операция с кратким содержанием…</p>}
    <button type="button" disabled={disabled || invalidRange} onClick={() => { void client.preview(mode === 'life_events' ? { mode, fromDateUTC, throughDateUTC } : undefined); }}>Составить краткое содержание</button>
    <button type="button" disabled={disabled} onClick={() => { void client.deleteSummary(); }}>Удалить краткое содержание</button>
    {state.message && <p role="status">{state.message}</p>}
    {state.text && <p>{state.text}</p>}
    {state.preview && <div role="group" aria-label="Предпросмотр краткого содержания">
      <p>{life ? 'Эти выбранные события' : 'Эти пары'} будут отправлены backend и внешнему AI-провайдеру только после подтверждения. Не более одной общей попытки за 24 часа для обоих видов источников, включая ошибку. Просмотр действует две минуты.</p>
      {life ? <>
        <p>С {life.fromDateUTC} по {life.throughDateUTC} (UTC). Выбранные события при работающей Wisp; не вся жизнь.</p>
        <ol>{life.events.map((event, index) => <li key={index}><p><time dateTime={event.occurredAt}>{event.occurredAt.slice(0, 10)} {event.occurredAt.slice(11, 19)} UTC</time>: игра — {outcome[event.outcome]}, {participation[event.participation]}. Причина: {cause[event.cause]}. Действующее лицо: {actor[event.actor]}. Длительность: {event.executedMs / 1000} с.</p></li>)}</ol>
      </> : 'pairs' in state.preview && <ol>{state.preview.pairs.map((pair, index) => <li key={index}><p>Вы: {pair.userText}</p><p>Wisp: {pair.assistantText}</p></li>)}</ol>}
      <p>Пересказ может ошибаться. Удаление сводки сохраняет источники и общее ограничение 24 часа; оно не удаляет уже отправленные данные у backend или провайдера.</p>
      <button type="button" disabled={disabled} onClick={() => { void client.confirm(); }}>{state.retry ? 'Проверить ту же команду' : life ? 'Подтверждаю отправку этих событий' : 'Подтверждаю отправку этих пар'}</button>
      <button type="button" disabled={disabled} onClick={() => client.cancelPreview()}>Отмена</button>
    </div>}
  </section>;
}
