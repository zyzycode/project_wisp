import { useState } from 'react';
import type { ContinuousVoiceState } from '../../continuous-voice-client';
interface Props {
  readonly client: { enable(language: 'ru' | 'en'): Promise<void>; disable(): void };
  readonly state: ContinuousVoiceState;
  readonly available: boolean;
  readonly contextReady: boolean;
}
const status: Record<ContinuousVoiceState['phase'], string> = {
  off: 'После паузы реплика отправится сама',
  starting: 'Ожидаем доступ к микрофону…',
  listening: 'Микрофон включён · слушаю',
  transcribing: 'Микрофон включён · распознаю…',
  sending: 'Микрофон включён · отправляю…',
  paused: 'Микрофон включён · пауза',
};
export function VoiceInputControls({ client, state, available, contextReady }: Props) {
  const [language, setLanguage] = useState<'ru' | 'en'>('ru');
  if (!available) return null;
  return <div className="chat-voice" data-wisp-interactive="true"
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <div className="chat-voice-controls">
      <button type="button" aria-pressed={state.enabled}
        disabled={!state.enabled && !contextReady}
        onClick={() => { if (state.enabled) client.disable(); else void client.enable(language); }}>
        {state.enabled ? 'Выключить микрофон' : 'Включить микрофон'}
      </button>
      <select aria-label="Язык распознавания" value={language} disabled={state.enabled}
        onChange={event => setLanguage(event.target.value === 'en' ? 'en' : 'ru')}>
        <option value="ru">RU</option><option value="en">EN</option>
      </select>
    </div>
    <div role="status" aria-live="polite" className="chat-voice-status">
      {status[state.phase]}
    </div>
    {state.error && <div role="alert" className="chat-voice-error">{state.error}</div>}
  </div>;
}
