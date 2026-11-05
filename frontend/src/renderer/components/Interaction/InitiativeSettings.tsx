import { useEffect, useRef, useState } from 'react';
import type { IInitiativeControls, InitiativeBlockReason, InitiativeControlStatusDTO } from '../../../application/ports/initiative-controls.interface';

interface Props {
  readonly bridge?: IInitiativeControls;
  readonly streamId?: string;
  readonly open: boolean;
  /** Existing Main snapshot projection refreshes status without a Renderer polling loop. */
  readonly status?: InitiativeControlStatusDTO;
}
const BLOCK: Record<InitiativeBlockReason, string> = {
  none: 'Wisp может заговорить, когда появится подходящий повод.',
  disabled: 'Самостоятельные реплики выключены.',
  provider_unavailable: 'AI-сервис недоступен. Повторных запросов по очереди не будет.',
  memory_unavailable: 'Память пока недоступна. Wisp ждёт восстановления.',
  quiet: 'Тихий режим: самостоятельные реплики приостановлены.',
  sleeping: 'Wisp спит. Самостоятельные реплики приостановлены.',
  away: 'Вы отошли. Самостоятельные реплики приостановлены.',
  busy: 'Wisp занят. Самостоятельные реплики подождут нового повода.',
};
const FAILURES: Record<InitiativeControlStatusDTO['lastFailure'], string> = {
  none: '', unavailable: 'Последний запрос не удалось выполнить.',
  auth: 'AI-сервис отклонил ключ. Проверьте подключение.',
  timeout: 'AI-сервис не успел ответить. Запрос не будет повторён автоматически.',
  invalid_response: 'Ответ AI-сервиса не прошёл проверку.',
};

export function InitiativeSettings({ bridge, streamId, open, status }: Props) {
  const [state, setState] = useState<InitiativeControlStatusDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    const current = ++epoch.current;
    pending.current = false; setBusy(false); setState(null); setError('');
    if (open && bridge && streamId) void bridge.read({ streamId }).then(result => {
      if (epoch.current !== current) return;
      if (result.ok) setState(result.status);
      else setError('Настройки изменились. Закройте и снова откройте меню.');
    }).catch(() => { if (epoch.current === current) setError('Не удалось прочитать настройки. Откройте меню снова.'); });
    return () => { epoch.current++; };
  }, [bridge, streamId, open]);
  useEffect(() => { if (status) setState(status); }, [status]);
  const toggle = async (enabled: boolean): Promise<void> => {
    if (!bridge || !streamId || !state || pending.current) return;
    const current = epoch.current;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await bridge.setConsent({ streamId, profileGeneration: state.profileGeneration, enabled });
      if (current !== epoch.current) return;
      if (result.ok) setState(result.status);
      else setError(result.code === 'unavailable' ? 'AI-сервис недоступен. Подключите его перед включением.'
        : 'Настройки изменились. Закройте и снова откройте меню.');
    } catch { if (current === epoch.current) setError('Не удалось изменить настройку. Откройте меню снова.'); }
    finally { if (current === epoch.current) { pending.current = false; setBusy(false); } }
  };
  if (!open || !bridge) return null;
  return <section className="initiative-settings" aria-label="Самостоятельные реплики">
    <label><input type="checkbox" checked={state?.enabled ?? false}
      disabled={!state || busy || (!state.enabled && state.capability !== 'ready')}
      onChange={event => { void toggle(event.target.checked); }} />
      Разрешить Wisp говорить первой в этой сессии</label>
    <p>Самостоятельные реплики отправляют разрешённый контекст в AI-сервис и могут расходовать платный API.
      Подключение ключа само по себе их не включает. После перезапуска или сброса разрешение выключается.</p>
    <p role="status" aria-live="polite">{busy ? 'Меняем разрешение…' : state
      ? state.phase === 'generating' ? 'Wisp готовит реплику.' : state.phase === 'visible'
        ? 'Wisp только что заговорила.' : BLOCK[state.blockReason] : 'Читаем разрешение…'}</p>
    {state && <p>Самостоятельных API-запросов за эту сессию: {state.requestsSent}.
      Это число отправок, а не стоимость.{FAILURES[state.lastFailure] && ` ${FAILURES[state.lastFailure]}`}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
