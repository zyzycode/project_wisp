import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { BrainStateDTO, WispApiBridge } from '../../../shared/ipc-contracts';
import { getMemoryOverviewClient, type MemoryOverviewBridge } from '../../memory-overview-client';
const fields = [
  ['user.display_name', 'Имя'], ['user.preferred_address', 'Обращение'], ['user.favorite_topic', 'Любимая тема'],
  ['user.reply_style', 'Стиль ответа'], ['user.cursor_game', 'Игра с курсором'],
] as const;
const labels: Readonly<Record<string, string>> = { brief: 'Краткие ответы', detailed: 'Подробные ответы', like: 'Нравится', dislike: 'Не нравится' };
const examples = [
  ['Исправление: Меня зовут Ирина', 'Correction: My name is Irene'],
  ['Называй меня Ира', 'Call me Irene'],
  ['Моя любимая тема — музыка', 'My favorite topic is music'],
  ['Я предпочитаю короткие ответы', 'I prefer short replies'],
  ['Я предпочитаю подробные ответы', 'I prefer detailed replies'],
  ['Мне нравится игра с курсором', 'I like the cursor game'],
  ['Мне не нравится игра с курсором', 'I dislike the cursor game'],
];
interface Props {
  readonly bridge: MemoryOverviewBridge;
  readonly snapshot: Pick<BrainStateDTO, 'streamId' | 'dialogue'> | null;
  readonly visible: boolean;
  readonly otherBusy?: boolean;
  readonly children?: ReactNode;
}
export function supportsMemoryOverview(bridge: Partial<WispApiBridge>): bridge is Partial<WispApiBridge> & MemoryOverviewBridge {
  return typeof bridge.getMemoryStatus === 'function' && typeof bridge.readMemoryFacts === 'function' && typeof bridge.clearMemory === 'function';
}
export function MemoryOverview({ bridge, snapshot, visible, otherBusy = false, children }: Props) {
  const client = getMemoryOverviewClient(bridge);
  const state = useSyncExternalStore(client.subscribe, client.getState, client.getState);
  const [help, setHelp] = useState(false);
  const streamId = snapshot?.streamId ?? null, conversationId = snapshot?.dialogue.conversationId ?? null;
  const turn = snapshot?.dialogue.turn;
  const completed = turn?.phase === 'completed' ? turn.requestId : null;
  useEffect(() => { client.acceptIdentity(streamId, conversationId); setHelp(false); }, [client, streamId, conversationId]);
  useEffect(() => { if (visible) void client.read(); }, [client, visible, streamId, conversationId, completed]);
  useEffect(() => { if (!visible) client.cancelConfirmation(); }, [client, visible]);
  if (!visible) return children;
  const locked = state.busy || state.uncertain;
  return <>
    <section aria-label="О вас">
      <h3>О вас</h3>
      {(state.loading || !snapshot || (!state.status && !state.message)) && <p role="status">Загружаем локальную память…</p>}
      {state.status?.mode === 'initializing' && <p role="status">Постоянная память ещё загружается. Обновите проверку позже.</p>}
      {state.status?.mode === 'persistent' && <p>Память сохраняется на этом устройстве.</p>}
      {state.status?.mode === 'volatile' && <p role="status">В этом запуске постоянное хранение недоступно. Старые данные могут сохраниться на устройстве. Перезапустите приложение для повторной проверки.</p>}
      {state.facts !== null && <dl>{fields.map(([key, title]) => {
        const value = state.facts?.find(fact => fact.key === key)?.value;
        return <div key={key}><dt>{title}</dt><dd>{value === undefined ? 'Не сохранено' : key === 'user.reply_style' || key === 'user.cursor_game' ? labels[value] : value}</dd></div>;
      })}</dl>}
      <p>Здесь только пять известных фактов. Переписка, события и состояние персонажа хранятся отдельно.</p>
      <button type="button" disabled={locked || state.loading || !snapshot} onClick={() => { void client.read(); }}>Обновить факты и статус</button>
      <button type="button" aria-expanded={help} onClick={() => setHelp(!help)}>Как исправить</button>
      {help && <div><p>Отправьте подходящую фразу сами в обычном чате, заменив пример своим значением. Ответ Wisp не подтверждает запись: затем обновите факты. Отдельное удаление факта здесь недоступно.</p>
        <ul>{examples.map(([ru, en]) => <li key={ru}><span lang="ru">{ru}</span><br /><span lang="en">{en}</span></li>)}</ul></div>}
    </section>
    <fieldset className="memory-actions" disabled={locked}>{children}</fieldset>
    <section aria-label="Очистка локальной памяти">
      <h3>Очистка</h3>
      <p>«Новый диалог» сбрасывает разговор и ожидающий ответ, сохраняя память. Полная очистка — отдельное необратимое действие.</p>
      <button type="button" disabled={locked || otherBusy || state.loading || state.status?.mode !== 'persistent'} onClick={() => client.openConfirmation()}>Очистить всю локальную память</button>
      {state.confirming && <div role="group" aria-label="Подтверждение полной очистки">
        <p>Удалить всю локальную память? Исчезнут переписка, факты, игровые эпизоды, события, шутки, краткое содержание, сохранённая тема разговора и бытовая гипотеза. Сбросятся потребности, накопленные отношения и привычки персонажа. Авторская личность, внешний вид и настройки сохранятся. Отменить удаление нельзя. Это не удаляет данные, уже переданные backend или AI-провайдеру.</p>
        <button type="button" disabled={locked || otherBusy} onClick={() => { void client.clear(); }}>Удалить всю локальную память</button>
        <button type="button" disabled={locked} onClick={() => client.cancelConfirmation()}>Отмена</button>
      </div>}
      {state.message && <p role="status">{state.message}</p>}
      {state.uncertain && <button type="button" disabled={state.busy} onClick={() => { void client.retry(); }}>Проверить ту же команду очистки</button>}
      {state.busy && <p>Закрытие панели не отменяет уже отправленную команду.</p>}
    </section>
  </>;
}
