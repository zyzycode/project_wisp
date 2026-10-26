import { useEffect, useSyncExternalStore } from 'react';
import type { BeveragePreferenceBridge, BrainStateDTO, WispApiBridge } from '../../../shared/ipc-contracts';
import { getBeverageClient } from '../../beverage-client';
import { getDialogueCommandClient } from '../../dialogue-command-client';
interface Props { readonly bridge: BeveragePreferenceBridge; readonly dialogueBridge?: Pick<WispApiBridge, 'postDialogueCommand'>; readonly snapshot: Pick<BrainStateDTO, 'streamId' | 'dialogue'> | null; readonly visible: boolean }
export function BeverageControls({ bridge, dialogueBridge, snapshot, visible }: Props) {
  const client = getBeverageClient(bridge), state = useSyncExternalStore(client.subscribe, client.getState, client.getState);
  const dialogue = dialogueBridge ? getDialogueCommandClient(dialogueBridge) : null;
  const proposalQueued = useSyncExternalStore(listener => dialogue?.subscribe(listener) ?? (() => {}), () => dialogue?.getState().beverageProposal === true, () => false);
  useEffect(() => { client.acceptStream(snapshot?.streamId ?? null); client.invalidateProjection(); }, [client, snapshot?.streamId, snapshot?.dialogue.conversationId]);
  useEffect(() => { if (visible) void client.read(); }, [client, visible, snapshot?.streamId, snapshot?.dialogue.conversationId, snapshot?.dialogue.canSubmit, snapshot?.dialogue.turn.phase, snapshot?.dialogue.turn.phase === 'completed' ? snapshot.dialogue.turn.requestId : null]);
  if (!visible) return null;
  const turn = snapshot?.dialogue.turn, offer = turn?.phase === 'completed' && 'beverageOffer' in turn ? turn.beverageOffer : undefined;
  const item = state.item, locked = state.busy || state.uncertain;
  const name = (value: 'coffee' | 'tea') => value === 'coffee' ? 'кофе' : 'чай';
  return <div role="group" aria-label="Предпочтение напитка">
    <p>Одно предпочтение: кофе или чай. AI предлагает догадку только по отдельному запросу; сохранение требует вашего согласия.</p>
    {dialogue && <button type="button" disabled={!snapshot?.dialogue.canSubmit} onClick={() => dialogue.requestBeverageProposal()}>Попросить догадку в ответе на следующее сообщение</button>}
    {proposalQueued && <p role="status">В следующем сообщении AI сможет предложить догадку о напитке. <button type="button" onClick={() => dialogue?.cancelBeverageProposal()}>Отменить запрос догадки</button></p>}
    {offer && !item && <div><p>Догадка AI: {name(offer.value)}. Предположение, не подтверждено.</p><blockquote>{offer.evidenceQuote}</blockquote><p>Сохранив, вы разрешаете использовать эту догадку в будущих AI-разговорах.</p><button type="button" disabled={locked || state.generation === null} onClick={() => { void client.mutate({ kind: 'save_hypothesis', offerId: offer.offerId }); }}>Сохранить как предположение</button></div>}
    {item && <div><p>{name(item.value)} — {item.status === 'withdrawn' ? 'не используется' : item.validity === 'hypothesis' ? 'Предположение, не подтверждено' : item.validity === 'rejected' ? 'отклонено' : 'подтверждено вами'}{item.manuallyCorrected ? '; исправлено вами' : ''}.</p>
      <blockquote>{item.evidenceQuote}</blockquote><p>Источник: ваше сообщение. Цитата объясняет происхождение, а ваше подтверждение — новое утверждение.</p>
      <button type="button" disabled={locked} onClick={() => { void client.mutate({ kind: 'confirm', value: item.value }); }}>Подтверждаю: я предпочитаю {name(item.value)}</button>
      <button type="button" disabled={locked} onClick={() => { void client.mutate({ kind: 'correct', value: item.value === 'coffee' ? 'tea' : 'coffee' }); }}>Исправить: я предпочитаю {name(item.value === 'coffee' ? 'tea' : 'coffee')}</button>
      <button type="button" disabled={locked} onClick={() => { void client.mutate({ kind: 'reject' }); }}>Это неверно</button>
      <button type="button" disabled={locked} onClick={() => { void client.mutate({ kind: 'withdraw' }); }}>Не использовать</button>
      <button type="button" disabled={locked} onClick={() => { void client.mutate({ kind: 'delete' }); }}>Удалить предпочтение</button>
      <p>Удаление убирает локальное предпочтение. Сообщения разговора и данные AI-провайдера этим действием не удаляются.</p>
    </div>}
    {state.message && <p role="status">{state.message}</p>}
    {state.uncertain && <button type="button" disabled={state.busy} onClick={() => { void client.retry(); }}>Повторить ту же команду</button>}
    <button type="button" disabled={locked} onClick={() => { void client.read(); }}>Обновить предпочтение</button>
  </div>;
}
