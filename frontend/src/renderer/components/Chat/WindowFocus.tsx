import { useEffect, useRef, useState } from 'react';
import type { IWindowFocusControls, WindowFocusStateDTO } from '../../../application/ports/window-focus-controls.interface';
import type { WindowFocusOpenCommandDTO, WindowFocusReceiptDTO } from '../../../application/ports/external-window-focus.port';
import './window-focus.css';
interface Props {
  readonly bridge?: IWindowFocusControls;
  readonly identity: { readonly streamId: string; readonly conversationId: string } | null;
  readonly open: boolean;
}
const percent = (value: number) => Math.round(value * 100);
function receiptText(receipt: WindowFocusReceiptDTO): string {
  if (receipt.status === 'unsupported') return 'Переключение окна доступно только в Windows.';
  if (receipt.status === 'unknown') return 'Результат не удалось подтвердить. Проверьте выбранное окно. Автоматического повтора не будет.';
  if (receipt.status === 'success') return receipt.effect === 'already_foreground' ? 'Выбранное окно уже было на переднем плане.' : 'Выбранное окно обнаружено на переднем плане.';
  if (receipt.reason === 'declined' || receipt.reason === 'cancelled_before_dispatch') return 'Переключение отменено.';
  if (receipt.reason === 'os_denied') return 'Windows не разрешила переключить фокус. Вы можете выбрать окно самостоятельно.';
  if (receipt.reason === 'target_changed' || receipt.reason === 'target_lost') return 'Окно закрылось или изменилось. Откройте список заново.';
  return 'Выбор устарел или переключение недоступно. Откройте список заново.';
}
/** One explicit local action; neither target geometry nor receipts enter dialogue history. */
export function WindowFocus({ bridge, identity, open }: Props) {
  const [expanded, setExpanded] = useState(false), [state, setState] = useState<WindowFocusStateDTO | null>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const request = useRef<WindowFocusOpenCommandDTO | null>(null), generation = useRef(0);
  const stream = identity?.streamId, conversation = identity?.conversationId;
  useEffect(() => {
    generation.current++; setExpanded(false); setState(null); setError(''); setPending(false);
    return () => { generation.current++; const old = request.current; request.current = null; if (old && bridge) void bridge.cancel(old).catch(() => undefined); };
  }, [bridge, stream, conversation, open]);
  useEffect(() => {
    if (!expanded || !open || !bridge) return;
    let stopped = false, reading = false;
    const timer = setInterval(() => {
      const command = request.current; if (!command || reading) return; reading = true; const token = generation.current;
      void bridge.read(command).then(result => { if (!stopped && token === generation.current) { if (result.ok) setState(result.state); else { setState(null); setError('Сессия изменилась. Откройте список заново.'); } } })
        .catch(() => { if (!stopped && token === generation.current) setError('Список окон недоступен. Попробуйте позже.'); }).finally(() => { reading = false; });
    }, 500);
    return () => { stopped = true; clearInterval(timer); };
  }, [expanded, open, bridge]);
  if (!open || !identity || !bridge) return null;
  const close = () => { const old = request.current; generation.current++; request.current = null; setExpanded(false); setState(null); setPending(false); if (old) void bridge.cancel(old).catch(() => undefined); };
  const start = async () => {
    if (pending) return;
    const command = { ...identity, requestId: crypto.randomUUID() }, token = ++generation.current;
    request.current = command; setExpanded(true); setState(null); setPending(true); setError('');
    try { const result = await bridge.open(command); if (token === generation.current) { if (result.ok) setState(result.state); else setError('Список окон сейчас недоступен. Попробуйте позже.'); } }
    catch { if (token === generation.current) setError('Список окон недоступен. Попробуйте позже.'); }
    finally { if (token === generation.current) setPending(false); }
  };
  const choose = async (selectionId: string) => {
    const current = request.current, selector = state?.selector;
    if (pending || !current || !selector) return;
    const token = generation.current; setPending(true); setError('');
    try { const result = await bridge.choose({ ...current, selectorId: selector.selectorId, selectionId }); if (token === generation.current) { if (result.ok) setState(result.state); else setError('Выбор изменился. Откройте список заново.'); } }
    catch { if (token === generation.current) setError('Результат недоступен. Проверьте окно перед новой попыткой.'); }
    finally { if (token === generation.current) setPending(false); }
  };
  return <div data-wisp-interactive="true" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <button type="button" className="window-focus-open" onClick={() => { void start(); }}>Показать окно</button>
    {expanded && <section className="window-focus-panel" aria-label="Выбор окна" onKeyDown={event => { if (event.key === 'Escape') close(); }}>
      <div className="window-focus-heading"><h2>Показать окно</h2><button type="button" onClick={close}>Закрыть</button></div>
      <p>Выберите окно по его положению на рабочем столе. Перед переключением появится системное подтверждение.</p>
      <p role="status" aria-live="polite">{error || (pending || state?.pending ? 'Ожидаю подтверждение или результат переключения…' : state?.receipt ? receiptText(state.receipt) : state?.capability === 'unsupported' ? 'Переключение окна доступно только в Windows.' : state?.capability === 'unavailable' ? 'Наблюдение за окнами недоступно. Попробуйте позже.' : !state?.selector?.candidates.length ? 'Подходящих доступных окон нет. Откройте список заново.' : 'Выбор действителен 30 секунд.')}</p>
      <div className="window-focus-choices">{state?.selector?.candidates.map((candidate, index) => <button type="button" key={candidate.selectionId} disabled={pending || state.pending} onClick={() => { void choose(candidate.selectionId); }}>
        <span className="window-focus-map" aria-hidden="true"><span style={{ left: `${candidate.left * 100}%`, top: `${candidate.top * 100}%`, width: `${candidate.width * 100}%`, height: `${candidate.height * 100}%` }} /></span>
        <span><strong>Окно {index + 1}</strong><small>Слева {percent(candidate.left)}%, сверху {percent(candidate.top)}%<br />Размер {percent(candidate.width)} × {percent(candidate.height)}%</small></span>
      </button>)}</div>
      {!pending && !state?.pending && <button type="button" onClick={() => { void start(); }}>Обновить список</button>}
      {pending && <button type="button" onClick={close}>Отменить</button>}
    </section>}
  </div>;
}
