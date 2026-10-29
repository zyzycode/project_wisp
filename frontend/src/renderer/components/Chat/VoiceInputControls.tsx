import { useState } from 'react';
import type { VoiceInputClient, VoiceInputState } from '../../voice-input-client';

interface Props {
  readonly client: VoiceInputClient;
  readonly state: VoiceInputState;
  readonly available: boolean;
  readonly contextReady: boolean;
}
const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} МБ`;
export function VoiceInputControls({ client, state, available, contextReady }: Props) {
  const [language, setLanguage] = useState<'ru' | 'en'>('ru');
  if (!available) return null;
  const { phase, model, error } = state;
  const busy = phase !== 'idle';
  const downloading = model?.state === 'downloading';
  return <div className="chat-voice">
    <div className="chat-voice-controls">
      {model?.state === 'ready' ? <>
        <select aria-label="Язык распознавания" value={language} disabled={busy}
          onChange={event => setLanguage(event.target.value === 'en' ? 'en' : 'ru')}>
          <option value="ru">RU</option><option value="en">EN</option>
        </select>
        {phase === 'recording'
          ? <button type="button" onClick={() => { void client.stop(); }}>Стоп</button>
          : <button type="button" disabled={busy || !contextReady} onClick={() => { void client.start(language); }}>Записать</button>}
        {busy && <button type="button" onClick={() => client.cancel()}>Отмена</button>}
      </> : <button type="button" disabled={downloading || !model || !contextReady}
        onClick={() => { void client.prepare(); }}>
        {downloading ? 'Загрузка модели…' : model?.state === 'error' ? 'Повторить загрузку' : 'Загрузить голосовой ввод'}
      </button>}
    </div>
    <div role="status" aria-live="polite" className="chat-voice-status">
      {phase === 'starting' ? 'Ожидаем доступ к микрофону…'
        : phase === 'recording' ? 'Идёт запись · до 30 секунд'
          : phase === 'transcribing' ? 'Распознаём на устройстве…'
            : downloading ? `${mb(model.downloadedBytes)} / ${model.totalBytes > 0 ? mb(model.totalBytes) : 'уточняем объём'}`
              : model?.state === 'ready' ? 'Локально · текст появится в черновике'
                : model ? `Whisper tiny · ${model.totalBytes > 0 ? mb(model.totalBytes) : 'локальная модель'} · затем без сети`
                  : 'Проверяем модель…'}
    </div>
    {error && <div role="alert" className="chat-voice-error">{error}</div>}
  </div>;
}
