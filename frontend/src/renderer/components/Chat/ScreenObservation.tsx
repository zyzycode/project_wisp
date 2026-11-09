import { useEffect, useRef, useState } from 'react';
import type { ScreenObservationBridge, ScreenObservationIdentity, ScreenObservationState } from '../../../shared/screen-observation-contracts';
import { parseScreenState } from '../../../shared/screen-observation-validation';
import './screen-observation.css';
const idle: ScreenObservationState = { phase: 'idle', error: null, preview: null, evidence: null };
const messages = { unavailable: 'Фрагмент недоступен. Проверьте подключение AI и попробуйте снова.', unsupported_platform: 'Показ фрагмента доступен только на Windows.', multiple_displays: 'Для показа фрагмента нужен один монитор.', busy: 'Подождите: другой запрос ещё выполняется или после захвата не прошло 30 секунд.', cancelled: 'Показ отменён.', timeout: 'Время ожидания истекло. Выберите фрагмент заново.', stale: 'Сессия изменилась. Выберите фрагмент заново.', invalid_response: 'Ответ не удалось проверить. Выберите фрагмент заново.' };
const phases = { idle: '', selecting: 'Выберите область на экране.', capture_confirmation: 'Подтвердите получение фрагмента в системном окне.', preparing: 'Готовлю предпросмотр…', preview: 'Проверьте фрагмент перед отправкой.', send_confirmation: 'Подтвердите отправку в системном окне.', generating: 'Ожидаю описание фрагмента…', visible: 'Наблюдение относится только к этому кадру.' };
interface Props { readonly bridge?: ScreenObservationBridge; readonly identity: ScreenObservationIdentity | null; readonly open: boolean }
/** A temporary read surface: never appends evidence to the dialogue transcript. */
export function ScreenObservation({ bridge, identity, open }: Props) {
  const [state, setState] = useState(idle), [expanded, setExpanded] = useState(false), [zoom, setZoom] = useState(false);
  const generation = useRef(0), active = useRef(false);
  active.current = open;
  const stream = identity?.streamId, conversation = identity?.conversationId;
  useEffect(() => {
    ++generation.current;
    setState(idle); setExpanded(false); setZoom(false);
    return () => { generation.current++; if (bridge && stream && conversation) void bridge.command({ type: 'cancel', streamId: stream, conversationId: conversation }).catch(() => undefined); };
  }, [bridge, stream, conversation, open]);
  useEffect(() => {
    if (!expanded || !open || !bridge || !stream || !conversation) return;
    let stopped = false, pending = false;
    const token = generation.current;
    const timer = setInterval(() => {
      if (pending) return; pending = true;
      void bridge.command({ type: 'read', streamId: stream, conversationId: conversation }).then(value => { if (!stopped && token === generation.current && active.current) setState(parseScreenState(value)); })
        .catch(() => { if (!stopped && token === generation.current) setState({ ...idle, error: 'unavailable' }); }).finally(() => { pending = false; });
    }, 250);
    return () => { stopped = true; clearInterval(timer); };
  }, [expanded, open, bridge, stream, conversation]);
  if (!open || !bridge || !identity) return null;
  const command = async (type: 'start' | 'send' | 'cancel') => {
    const token = generation.current;
    if (type === 'start') { setExpanded(true); setState({ ...idle, phase: 'selecting' }); }
    try { const result = parseScreenState(await bridge.command({ ...identity, type })); if (token === generation.current && active.current) setState(result); }
    catch { if (token === generation.current && active.current) setState({ ...idle, error: 'unavailable' }); }
  };
  const close = () => { void command('cancel'); setExpanded(false); setZoom(false); setState(idle); };
  return <div data-wisp-interactive="true" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <button className="screen-start" type="button" onClick={() => { void command('start'); }}>Показать фрагмент</button>
    {expanded && <section className="screen-panel" aria-label="Показ фрагмента экрана" onKeyDown={event => { if (event.key === 'Escape') close(); }}>
      <div className="screen-heading"><h2>Фрагмент экрана</h2><button type="button" onClick={close} aria-label="Закрыть показ фрагмента">Закрыть</button></div>
      <p role="status" aria-live="polite">{state.error ? messages[state.error] : phases[state.phase]}</p>
      {state.preview && <>
        <div className={`screen-preview ${zoom ? 'screen-preview-zoom' : ''}`}><img src={`data:image/jpeg;base64,${state.preview.dataBase64}`} width={state.preview.width} height={state.preview.height} alt="Точный выбранный фрагмент, который будет отправлен" draggable={false} /></div>
        <label><input type="checkbox" checked={zoom} onChange={event => setZoom(event.target.checked)} /> Показать в исходном размере</label>
        <p className="screen-disclosure">Только этот фрагмент будет отправлен OpenAI через личный локальный сервер: один платный запрос. Без opt-in API-данные не используются для обучения. Проверки нарушений обычно хранят данные до 30 дней, дольше — по закону; изображения, отмеченные проверкой безопасности, могут сохраняться для ручной проверки даже при режиме без хранения. Отключение сохранения ответа не означает нулевое хранение. Удаление локального предпросмотра не удаляет уже отправленное у провайдера.</p>
        <div className="screen-actions"><button type="button" disabled={state.phase !== 'preview'} onClick={() => { void command('send'); }}>Отправить этот фрагмент</button><button type="button" onClick={close}>Отмена</button></div>
      </>}
      {state.evidence && <div className="screen-evidence">{(['visible', 'possible', 'unknown'] as const).map((key, i) => <div key={key}><h3>{['Видно', 'Возможно', 'Не удалось определить'][i]}</h3>{state.evidence![key].length ? <ul>{state.evidence![key].map((text, index) => <li key={index}>{text}</li>)}</ul> : <p>Нет утверждений.</p>}</div>)}<p>Не сохраняется в памяти и исчезнет не позднее чем через минуту.</p></div>}
      {(state.phase === 'idle' || state.phase === 'visible') && <button type="button" onClick={() => { void command('start'); }}>Выбрать новый фрагмент</button>}
      {!state.preview && state.phase !== 'idle' && state.phase !== 'visible' && <button type="button" onClick={close}>Отменить</button>}
    </section>}
  </div>;
}
