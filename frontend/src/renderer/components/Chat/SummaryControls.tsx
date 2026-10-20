import { useEffect, useSyncExternalStore } from 'react';
import type { BrainStateDTO, SummaryApiBridge } from '../../../shared/ipc-contracts';
import { getSummaryClient } from '../../summary-client';
interface Props { readonly visible?: boolean; readonly bridge: SummaryApiBridge; readonly snapshot: Pick<BrainStateDTO, 'streamId' | 'dialogue'> | null }
export function SummaryControls({ bridge, snapshot, visible = true }: Props) {
  const client = getSummaryClient(bridge);
  const state = useSyncExternalStore(client.subscribe, client.getState, client.getState);
  useEffect(() => client.acceptIdentity(snapshot?.streamId ?? null, snapshot?.dialogue.conversationId ?? null), [client, snapshot?.streamId, snapshot?.dialogue.conversationId]);
  if (!visible) return null;
  const disabled = state.busy || !snapshot;
  return <section aria-label="Краткое содержание">
    <p>Для краткого содержания нужны включённый сервис и не менее четырёх подходящих пар сообщений.</p>
    {!snapshot && <p role="status">Ожидаем подключение к диалогу…</p>}
    {state.busy && <p role="status">Выполняется операция с кратким содержанием…</p>}
    <button type="button" disabled={disabled} onClick={() => { void client.preview(); }}>Составить краткое содержание</button>
    <button type="button" disabled={disabled} onClick={() => { void client.deleteSummary(); }}>Удалить краткое содержание</button>
    {state.message && <p role="status">{state.message}</p>}
    {state.text && <p>{state.text}</p>}
    {state.preview && <div role="group" aria-label="Предпросмотр краткого содержания">
      <p>Эти пары будут отправлены backend и внешнему AI-провайдеру только после подтверждения. Не более одной попытки за 24 часа, включая ошибку. Просмотр действует две минуты.</p>
      <ol>{state.preview.pairs.map((pair, index) => <li key={index}><p>Вы: {pair.userText}</p><p>Wisp: {pair.assistantText}</p></li>)}</ol>
      <p>Пересказ может ошибаться. Локальное удаление не удаляет уже отправленные данные у backend или провайдера.</p>
      <button type="button" disabled={disabled} onClick={() => { void client.confirm(); }}>{state.retry ? 'Проверить ту же команду' : 'Подтверждаю отправку этих пар'}</button>
      <button type="button" disabled={disabled} onClick={() => client.cancelPreview()}>Отмена</button>
    </div>}
  </section>;
}
