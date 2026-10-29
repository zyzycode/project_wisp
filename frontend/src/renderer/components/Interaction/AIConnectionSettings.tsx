import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  AIConnectionApiBridge,
  AIConnectionResultDTO,
  AIConnectionStatusDTO,
} from '../../../shared/ipc-contracts';

interface Props {
  readonly bridge?: AIConnectionApiBridge;
  readonly streamId?: string;
  readonly open: boolean;
}

const FAILURES: Record<Exclude<AIConnectionStatusDTO['failure'], null>, string> = {
  secure_storage_unavailable: 'Защищённое хранилище недоступно. Сохранить ключ сейчас нельзя.',
  storage_error: 'Не удалось прочитать сохранённый ключ. Можно заменить его или отключить подключение.',
  runtime_unavailable: 'Локальный AI-сервис недоступен в этой установке. Wisp продолжает работать офлайн.',
  startup_failed: 'Локальный AI-сервис не запустился. Wisp продолжает работать офлайн.',
  startup_timeout: 'Локальный AI-сервис не успел запуститься. Wisp продолжает работать офлайн.',
};
type FailureCode = Extract<AIConnectionResultDTO, { readonly ok: false }>['code'];
const ERRORS: Record<FailureCode, string> = {
  invalid_input: 'Не удалось сохранить ключ. Вставьте API-ключ OpenAI без пробелов внутри.',
  stale: 'Настройки изменились. Закройте и снова откройте меню.',
  busy: 'Настройки уже сохраняются. Подождите и откройте меню снова.',
  externally_managed: 'Подключение управляется внешним сервером. Изменить его здесь нельзя.',
  secure_storage_unavailable: 'Защищённое хранилище недоступно. Ключ не сохранён.',
  storage_error: 'Не удалось изменить сохранённый ключ. Попробуйте ещё раз.',
};

function connectionStatus(state: AIConnectionStatusDTO): string {
  if (state.mode === 'external') return 'Подключение настроено через внешний сервер.';
  if (state.failure) return FAILURES[state.failure];
  if (state.mode === 'ready') return 'Локальный AI-сервис готов. Работоспособность ключа ещё не проверена.';
  if (state.mode === 'unavailable') return 'AI-сервис недоступен. Wisp продолжает работать офлайн.';
  return state.hasSavedKey ? 'Ключ сохранён. AI-сервис пока не готов.' : 'Офлайн-режим. Личный ключ не сохранён.';
}

export function AIConnectionSettings({ bridge, streamId, open }: Props) {
  const [state, setState] = useState<AIConnectionStatusDTO | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [restart, setRestart] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const mutationPending = useRef(false);

  useEffect(() => {
    const epoch = ++generation.current;
    mutationPending.current = false;
    setState(null);
    setApiKey('');
    setBusy(false);
    setRestart(null);
    setError(null);
    if (open && bridge && streamId) {
      void bridge.read({ streamId }).then(next => {
        if (generation.current === epoch) setState(next);
      }).catch(() => {
        if (generation.current === epoch) setError('Не удалось открыть настройки подключения. Закройте и снова откройте меню.');
      });
    }
    return () => { generation.current++; };
  }, [bridge, streamId, open]);

  const configure = async (kind: 'save' | 'remove'): Promise<void> => {
    if (!bridge || !streamId || !state || mutationPending.current || restart || state.mode === 'external') return;
    if (kind === 'save' && (!state.secureStorageAvailable || !apiKey.trim())) return;
    if (kind === 'remove' && !state.hasSavedKey) return;
    const epoch = generation.current;
    mutationPending.current = true;
    setBusy(true);
    setError(null);
    setApiKey('');
    let restartScheduled = false;
    try {
      const result = await bridge.configure(kind === 'save'
        ? { streamId, kind, apiKey: apiKey.trim() }
        : { streamId, kind });
      if (generation.current !== epoch) return;
      if (result.ok) {
        restartScheduled = true;
        setRestart(kind);
      }
      else setError(ERRORS[result.code]);
    } catch {
      if (generation.current === epoch) setError('Не удалось изменить подключение. Закройте и снова откройте меню.');
    } finally {
      if (generation.current === epoch) {
        mutationPending.current = restartScheduled;
        setBusy(false);
      }
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void configure('save');
  };

  if (!open || !bridge) return null;
  const external = state?.mode === 'external';
  const statusText = restart === 'save'
    ? 'Ключ сохранён. Перезапускаем Wisp для подключения. Память сохранится.'
    : restart === 'remove'
      ? 'Ключ удалён. Перезапускаем Wisp в офлайн-режиме. Память сохранится.'
      : busy ? 'Сохраняем настройки…' : state ? connectionStatus(state)
        : error ? 'Настройки подключения недоступны.' : 'Загружаем настройки подключения…';
  return <details className="ai-connection-settings menu-section" onToggle={event => {
    if (!event.currentTarget.open) setApiKey('');
  }}>
    <summary>Подключение AI</summary>
    <p>OpenAI</p>
    <p role="status" aria-live="polite">{statusText}</p>
    {error && <p role="alert">{error}</p>}
    {state && !external && <>
      <p>Для ответа ваши сообщения и разрешённая память Wisp передаются OpenAI. Использование API может быть платным.</p>
      <p>Сохранение перезапустит Wisp с прежней памятью. Оно не отправляет запрос в OpenAI и не проверяет ключ.</p>
      <form onSubmit={submit}>
        <fieldset disabled={busy || restart !== null}>
          <label>API-ключ OpenAI
            <input type="password" value={apiKey} autoComplete="off" spellCheck={false}
              autoCapitalize="none" maxLength={512} placeholder={state.hasSavedKey ? 'Вставьте новый ключ для замены' : 'Вставьте API-ключ'}
              disabled={!state.secureStorageAvailable} onChange={event => setApiKey(event.target.value)} />
          </label>
          {state.hasSavedKey && <p>Ключ уже сохранён. Он не отображается в этом поле.</p>}
          {!state.secureStorageAvailable && <p>Защищённое хранилище недоступно. Сохранение ключа отключено.</p>}
          <div className="ai-connection-actions">
            <button type="submit" disabled={!state.secureStorageAvailable || !apiKey.trim()}>Сохранить и подключить</button>
            {state.hasSavedKey && <button type="button" onClick={() => { void configure('remove'); }}>Отключить</button>}
          </div>
        </fieldset>
      </form>
    </>}
    {external && <p>Личный ключ здесь не используется. Настройки внешнего сервера меняются отдельно.</p>}
  </details>;
}
