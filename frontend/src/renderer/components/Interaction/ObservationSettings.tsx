import { useEffect, useRef, useState } from 'react';
import type { ObservationBridge, ObservationCommandDTO, ObservationSettingsDTO } from '../../../shared/observation-contracts';
export const OBSERVATION_DISCLOSURE = 'Название разрешённого приложения и заголовок активного окна отправляются backend и внешнему AI-провайдеру для короткой реакции персонажа. Заголовок может содержать личные данные. Отключение останавливает новые отправки, но не отзывает уже отправленные данные';
const REASONS = { backend_unavailable: 'AI-наблюдение недоступно: backend не настроен', disabled: 'Выключено', paused: 'На паузе', unsupported: 'Доступно только в Windows', initializing: 'Подключение', excluded: 'Приложение не разрешено', permission_denied: 'Нет доступа', bridge_failed: 'Наблюдение остановлено. Возобновите явно.', stale: 'Нет актуального наблюдения' };
type Action = ObservationCommandDTO extends infer C ? C extends ObservationCommandDTO ? Omit<C, 'streamId' | 'generation'> : never : never;
interface Props { readonly bridge?: ObservationBridge['observationCommand']; readonly streamId?: string; readonly open: boolean; }
export function ObservationSettings({ bridge, streamId, open }: Props) {
  const [state, setState] = useState<ObservationSettingsDTO | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const latest = useRef(state); latest.current = state;
  const lifecycle = useRef(0);
  useEffect(() => {
    const epoch = ++lifecycle.current; setState(null); setError(false); setBusy(false);
    if (!bridge || !streamId || !open) return;
    let pending = false;
    const refresh = async () => {
      if (pending) return; pending = true;
      try { const next = await bridge({ type: 'get', streamId, generation: 0 }); if (lifecycle.current === epoch) setState(next); }
      catch { if (lifecycle.current === epoch) setError(true); }
      finally { pending = false; }
    };
    void refresh(); const timer = setInterval(() => { void refresh(); }, 1000);
    return () => { lifecycle.current++; clearInterval(timer); const current = latest.current; if (current) void bridge({ type: 'preview-close', streamId, generation: current.generation }).catch(() => undefined); };
  }, [bridge, streamId, open]);
  const command = async (action: Action) => {
    if (!state || !streamId || !bridge || busy) return;
    const epoch = lifecycle.current; setBusy(true); setError(false);
    try { const next = await bridge({ ...action, streamId, generation: state.generation }); if (lifecycle.current === epoch) setState(next); }
    catch { if (lifecycle.current === epoch) setError(true); }
    finally { if (lifecycle.current === epoch) setBusy(false); }
  };
  if (!open || !bridge) return null;
  return <details className="menu-section"><summary>Наблюдение</summary>
    <p>{OBSERVATION_DISCLOSURE}</p>
    <p>Настройки хранятся только в памяти: после перезапуска список приложений и согласие очищаются. Хранение уже отправленных данных определяется политикой backend и AI-провайдера; локальное удаление их не отзывает.</p>
    <p role="status">{state ? state.reason ? REASONS[state.reason] : 'Наблюдение доступно' : 'Загрузка настроек'}</p>
    {error && <p role="alert">Настройки недоступны. Откройте меню заново.</p>}
    {state && <fieldset disabled={busy}>
      <label><input type="checkbox" checked={state.enabled} onChange={event => { void command({ type: event.target.checked ? 'enable' : 'disable' }); }} />Разрешить отправку названия приложения и заголовка окна</label>
      <button type="button" onClick={() => { void command({ type: 'pick' }); }}>Выбрать приложение…</button>
      {state.applications.map(app => <div key={app.appKey}><span>{app.alias}</span>
        <label><input type="checkbox" checked={app.excluded} onChange={event => { void command({ type: 'exclude', appKey: app.appKey, excluded: event.target.checked }); }} />Исключить</label>
        <button type="button" onClick={() => { void command({ type: 'remove', appKey: app.appKey }); }}>Удалить</button></div>)}
      <button type="button" disabled={!state.enabled} onClick={() => { void command({ type: state.paused ? 'resume' : 'pause' }); }}>{state.paused ? 'Возобновить' : 'Пауза'}</button>
      <button type="button" onClick={() => { void command({ type: 'clear' }); }}>Удалить настройки</button>
      <button type="button" onClick={() => { void command({ type: state.previewOpen ? 'preview-close' : 'preview-open' }); }}>{state.previewOpen ? 'Закрыть preview' : 'Показать preview'}</button>
      {state.previewOpen && <div aria-label="Observation preview">{state.preview ? <><p>{state.preview.appName}</p><p>{state.preview.windowTitle || '(пустой заголовок)'}</p></> : <p>Нет разрешённого актуального окна</p>}</div>}
    </fieldset>}
  </details>;
}
