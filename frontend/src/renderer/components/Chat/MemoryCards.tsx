import { SummaryControls } from './SummaryControls';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import type { BrainStateDTO, MemoryCardContentDTO, MemoryCardDTO, MemoryCardSourceDTO, WispApiBridge } from '../../../shared/ipc-contracts';
import { getMemoryCardClient } from '../../memory-card-client';

interface Props { readonly bridge: Pick<WispApiBridge, 'mutateMemoryCard' | 'listMemoryCards' | 'summary'>; readonly snapshot: Pick<BrainStateDTO, 'streamId' | 'dialogue'> | null }
interface Draft extends MemoryCardContentDTO { readonly source: MemoryCardSourceDTO; readonly item?: MemoryCardDTO }
export function MemoryCards({ bridge, snapshot }: Props) {
  const panelId = useId();
  const client = getMemoryCardClient(bridge);
  const state = useSyncExternalStore(client.subscribe, client.getState, client.getState);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removal, setRemoval] = useState<{ kind: 'withdraw' | 'delete'; item: MemoryCardDTO } | null>(null);
  const streamId = snapshot?.streamId ?? null;
  useEffect(() => { client.acceptStream(streamId); setDraft(null); setRemoval(null); }, [client, streamId]);
  useEffect(() => { if (open) void client.list(); }, [client, streamId, open]);
  const turn = snapshot?.dialogue.turn;
  const source = turn?.phase === 'completed' && turn.outcome.kind === 'success' ? turn.memorySource : undefined;
  const locked = state.busy || state.uncertain;
  function begin(category: MemoryCardContentDTO['category']) {
    if (!source) return;
    setOpen(true); setRemoval(null); setDraft({ category, label: '', text: '', occurredOn: null, source });
  }
  return <section className={`memory-panel${open ? ' is-open' : ''}`} data-wisp-interactive="true" aria-label="Карточки памяти">
    <button type="button" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(!open)}>Память</button>
    {open && <div id={panelId}>
      {source ? <><button type="button" disabled={locked} onClick={() => begin('important_event')}>Сохранить событие</button>
        <button type="button" disabled={locked} onClick={() => begin('shared_joke')}>Сохранить шутку</button></>
        : <p>Сохранение события или шутки доступно после завершённого ответа, сохранённого в истории разговора.</p>}
      {!streamId && <p role="status">Подключаем память…</p>}
      {state.busy && <p role="status">Выполняется операция с памятью…</p>}
      {!state.busy && state.generation !== null && state.items.length === 0 && <p>Сохранённых карточек пока нет.</p>}
      <p>Сохраняются только явно подтверждённые карточки. Отзыв и удаление карточки сохраняют переписку.</p>
      {state.message && <p role="status">{state.message}</p>}
      {state.uncertain && <button type="button" disabled={state.busy} onClick={() => { void client.retry().then(ok => { if (ok) { setDraft(null); setRemoval(null); } }); }}>Повторить ту же команду</button>}
      {draft && <form onSubmit={event => {
        event.preventDefault();
        void client.save({ category: draft.category, label: draft.label.trim(), text: draft.text.trim(), occurredOn: draft.occurredOn }, draft.source, draft.item)
          .then(ok => { if (ok) setDraft(null); });
      }}>
        <p>{draft.category === 'important_event' ? 'Событие' : 'Общая шутка'} — проверьте перед подтверждением</p>
        <label>Название<input required maxLength={80} value={draft.label} disabled={locked} onChange={event => setDraft({ ...draft, label: event.target.value })} /></label>
        <label>Текст<textarea required maxLength={400} value={draft.text} disabled={locked} onChange={event => setDraft({ ...draft, text: event.target.value })} /></label>
        <label>Дата (необязательно)<input type="date" value={draft.occurredOn ?? ''} disabled={locked} onChange={event => setDraft({ ...draft, occurredOn: event.target.value || null })} /></label>
        <button type="submit" disabled={locked || state.generation === null || !draft.label.trim() || !draft.text.trim()}>Подтвердить сохранение</button>
        <button type="button" disabled={locked} onClick={() => setDraft(null)}>Отмена</button>
      </form>}
      {removal && <div role="group" aria-label="Подтверждение изменения памяти"><p>{removal.kind === 'delete' ? 'Удалить карточку' : 'Отозвать подтверждение'} «{removal.item.label}»? Переписка останется.</p>
        <button type="button" disabled={locked} onClick={() => { void client.remove(removal.kind, removal.item).then(ok => { if (ok) setRemoval(null); }); }}>Подтвердить {removal.kind === 'delete' ? 'удаление' : 'отзыв'}</button>
        <button type="button" disabled={locked} onClick={() => setRemoval(null)}>Отмена</button></div>}
      <ul>{state.items.map(item => <li key={item.id}><strong>{item.label}</strong> — {item.text}{item.occurredOn ? ` (${item.occurredOn})` : ''}{item.status === 'withdrawn' ? ' — отозвано' : ''}
        <button type="button" disabled={locked} onClick={() => { setRemoval(null); setDraft({ ...item, item }); }}>Изменить</button>
        {item.status === 'active' && <button type="button" disabled={locked} onClick={() => { setDraft(null); setRemoval({ kind: 'withdraw', item }); }}>Отозвать</button>}
        <button type="button" disabled={locked} onClick={() => { setDraft(null); setRemoval({ kind: 'delete', item }); }}>Удалить</button>
      </li>)}</ul>
      <button type="button" disabled={locked} onClick={() => { void client.list(); }}>Обновить список</button>
      {state.nextCursor !== null && <button type="button" disabled={locked} onClick={() => { void client.list(state.nextCursor); }}>Следующие 20</button>}
    </div>}
    {bridge.summary && <SummaryControls bridge={bridge.summary} snapshot={snapshot} visible={open} />}
  </section>;
}
