import { useEffect, useState, useSyncExternalStore } from 'react';
import type { BrainStateDTO, InterestThreadApiBridge, MemoryCardSourceDTO, WispApiBridge } from '../../../shared/ipc-contracts';
import { getInterestThreadClient } from '../../interest-thread-client';
import { getDialogueCommandClient } from '../../dialogue-command-client';
interface Props {
  readonly bridge: InterestThreadApiBridge;
  readonly dialogueBridge?: Pick<WispApiBridge, 'postDialogueCommand'>;
  readonly snapshot: Pick<BrainStateDTO, 'streamId' | 'dialogue'> | null;
  readonly visible: boolean;
}
export function InterestThreadControls({ bridge, dialogueBridge, snapshot, visible }: Props) {
  const client = getInterestThreadClient(bridge);
  const state = useSyncExternalStore(client.subscribe, client.getState, client.getState);
  const [draft, setDraft] = useState<{ source: MemoryCardSourceDTO; conversationId: string; text: string } | null>(null);
  useEffect(() => { client.acceptStream(snapshot?.streamId ?? null); client.invalidateProjection(); setDraft(null); }, [client, snapshot?.streamId, snapshot?.dialogue.conversationId]);
  useEffect(() => { if (visible) void client.read(); }, [client, visible, snapshot?.streamId, snapshot?.dialogue.conversationId, snapshot?.dialogue.canSubmit, snapshot?.dialogue.turn.phase, snapshot?.dialogue.turn.phase === 'completed' ? snapshot.dialogue.turn.requestId : null]);
  if (!visible) return null;
  const turn = snapshot?.dialogue.turn;
  const source = turn?.phase === 'completed' && turn.outcome.kind === 'success' ? turn.memorySource : undefined;
  const locked = state.busy || state.uncertain;
  return <div role="group" aria-label="Тема разговора">
    <p>Одна тема для возможного вопроса в будущем разговоре: не раньше чем через сутки, в течение недели, не более одной попытки.</p>
    {source && <button type="button" disabled={locked} onClick={() => setDraft({ source, conversationId: snapshot!.dialogue.conversationId, text: '' })}>Вернуться к теме</button>}
    {draft && <form onSubmit={event => { event.preventDefault(); void client.mutate({ kind: 'confirm', ...draft, text: draft.text.trim() }).then(ok => { if (ok) setDraft(null); }); }}>
      <label>Точная цитата из вашего сообщения<input required maxLength={160} value={draft.text} disabled={locked} onChange={event => setDraft({ ...draft, text: event.target.value })} /></label>
      <p>Подтверждая, вы сохраняете цитату и разрешаете передать её настроенному AI в обычном разговоре.{state.item ? ' Текущая тема будет заменена.' : ''}</p>
      <button type="submit" disabled={locked || state.generation === null || !draft.text.trim()}>Подтвердить тему и передачу AI</button>
      <button type="button" disabled={locked} onClick={() => setDraft(null)}>Отмена</button>
    </form>}
    {state.item && <div><p>{state.item.state === 'unanswered' ? state.item.text : state.item.state === 'answered' ? 'Ответ по теме сохранён.' : 'Тема закрыта.'}</p>
      {state.item.state === 'unanswered' && <>
        {dialogueBridge && <button type="button" disabled={locked} onClick={() => getDialogueCommandClient(dialogueBridge).selectTopic(state.item!.ref, state.item!.text ?? '')}>Ответить по теме</button>}
        <button type="button" disabled={locked} onClick={() => { void client.mutate({ kind: 'close', reason: 'declined' }); }}>Не спрашивать</button>
        <button type="button" disabled={locked} onClick={() => { void client.mutate({ kind: 'close', reason: 'dismissed' }); }}>Закрыть тему</button>
      </>}
      <button type="button" disabled={locked} onClick={() => { void client.mutate({ kind: 'delete' }); }}>Удалить тему</button>
    </div>}
    {state.message && <p role="status">{state.message}</p>}
    {state.uncertain && <button type="button" disabled={state.busy} onClick={() => { void client.retry(); }}>Повторить ту же команду темы</button>}
    <button type="button" disabled={locked} onClick={() => { void client.read(); }}>Обновить тему</button>
  </div>;
}
