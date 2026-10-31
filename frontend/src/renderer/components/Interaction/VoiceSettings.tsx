import { useSyncExternalStore } from 'react';
import type { VoiceReplyOutput, VoiceReplyState } from '../../voice-reply-output';
import type { ContinuousVoiceClient, ContinuousVoiceState } from '../../continuous-voice-client';
interface Props {
  readonly output: VoiceReplyOutput;
  readonly outputState: VoiceReplyState;
  readonly input: ContinuousVoiceClient;
  readonly inputState: ContinuousVoiceState;
  readonly contextReady: boolean;
}
export function VoiceSettings({ output, outputState, input, inputState, contextReady }: Props) {
  const audio = useSyncExternalStore(output.audio.subscribe, output.audio.getSnapshot, output.audio.getSnapshot);
  const missing = audio.deviceId && !audio.devices.some(device => device.id === audio.deviceId);
  const active = outputState.phase === 'preparing' || outputState.phase === 'speaking';
  return <section className="ai-connection-settings audio-output-settings menu-section">
    <div className="menu-section-title">Голос и звук</div>
    <p>Микрофон выключен при запуске. Включение потребует подтверждения. Озвучка включается отдельно.</p>
    <label className="voice-setting-toggle"><input type="checkbox" checked={inputState.enabled} disabled={!inputState.enabled && !contextReady}
      onChange={event => { if (event.target.checked) void input.enableSelected(); else input.disable(); }} />Микрофон</label>
    <label className="voice-setting-toggle"><input type="checkbox" checked={outputState.enabled} disabled={!outputState.ready && !outputState.enabled}
      onChange={event => { void output.configure(event.target.checked); }} />Озвучивать ответы</label>
    <label>Куда выводить голос
      <select aria-label="Устройство вывода звука" value={audio.deviceId ?? '__loading__'} disabled={audio.busy}
        onChange={event => { void output.selectDevice(event.target.value); }}>
        {audio.deviceId === null && <option value="__loading__" disabled>Выберите аудиовыход</option>}
        <option value="">Системное устройство</option>
        {missing && <option value={audio.deviceId ?? ''} disabled>Сохранённое устройство — проверить</option>}
        {audio.devices.filter(device => device.id && device.id !== 'default').map(device => <option key={device.id} value={device.id}>{device.label}</option>)}
      </select>
    </label>
    {!audio.devices.length && <p>Для списка устройств разрешите доступ к микрофону. Можно оставить системный выход.</p>}
    <p>Проверка воспроизводит короткий сигнал в выбранном устройстве.</p>
    <button type="button" disabled={audio.busy || audio.deviceId === null || active}
      onClick={() => { void output.test(); }}>Проверить звук</button>
    {audio.busy && <p role="status">Сохраняем аудиовыход…</p>}
    {audio.error && <p role="alert">{audio.error}</p>}
  </section>;
}
