import type { VoiceReplyState } from '../../voice-reply-output';
interface Props {
  readonly client: { configure(enabled: boolean): Promise<void>; clear(): void };
  readonly state: VoiceReplyState;
  readonly available: boolean;
}
export function VoiceOutputControls({ client, state, available }: Props) {
  if (!available) return null;
  const active = state.phase === 'preparing' || state.phase === 'speaking';
  return <div className="chat-voice chat-voice-output" data-wisp-interactive="true"
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <div className="chat-voice-controls">
      <button type="button" aria-pressed={state.enabled} disabled={!state.ready && !state.enabled}
        onClick={() => { void client.configure(!state.enabled); }}>
        {state.enabled ? 'Выключить озвучку' : 'Включить озвучку'}
      </button>
      {active && <button type="button" onClick={() => client.clear()}>Остановить речь</button>}
    </div>
    <div className="chat-voice-status" role="status" aria-live="polite">
      {!state.ready ? 'Озвучка недоступна · текст работает' : state.phase === 'preparing' ? 'Готовлю голос · микрофон на паузе' : state.phase === 'speaking' ? 'Говорю · микрофон на паузе' : state.enabled ? 'Голос включён' : 'Ответы текстом'}
    </div>
    {state.error && <div className="chat-voice-error" role="alert">{state.error}</div>}
  </div>;
}
