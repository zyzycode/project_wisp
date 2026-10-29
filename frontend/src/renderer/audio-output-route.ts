import type { VoiceOutputBridge, VoicePlaybackDTO } from '../shared/voice-output-contracts';
import { playSpeech, type PlaySpeech } from './audio-playback';
export interface AudioOutputState {
  readonly deviceId: string | null;
  readonly devices: readonly { readonly id: string; readonly label: string }[];
  readonly busy: boolean;
  readonly error: string | null;
}
export class AudioOutputRoute {
  private state: AudioOutputState = { deviceId: null, devices: [], busy: false, error: null };
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private abort?: AbortController;
  private missing = false;
  private disconnected = false;
  constructor(private readonly bridge: VoiceOutputBridge | undefined,
    private readonly media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined,
    private readonly playback: PlaySpeech = playSpeech) {}
  public getSnapshot = () => this.state;
  public subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<AudioOutputState>): void { this.state = { ...this.state, ...change }; for (const listener of this.listeners) listener(); }
  public async initialize(): Promise<void> {
    const generation = ++this.generation;
    this.media?.addEventListener('devicechange', this.deviceChanged);
    try {
      const result = await this.bridge?.readDevice();
      if (generation !== this.generation) return;
      if (!result?.ok) throw new Error('Preference unavailable');
      this.update({ deviceId: result.value.deviceId, error: null });
      await this.refresh();
    } catch { if (generation === this.generation) this.update({ deviceId: null, error: 'Не удалось загрузить аудиовыход. Выберите устройство заново.' }); }
  }
  public refresh = async (): Promise<void> => {
    const generation = this.generation;
    try {
      const devices = (await this.media?.enumerateDevices() ?? []).filter(device => device.kind === 'audiooutput').map((device, i) => ({ id: device.deviceId, label: device.label || `Аудиовыход ${i + 1}` }));
      if (generation !== this.generation) return;
      this.missing = Boolean(this.state.deviceId && !devices.some(device => device.id === this.state.deviceId));
      const remembered = this.state.devices.filter(previous => !devices.some(device => device.id === previous.id));
      this.update({ devices: [...devices, ...remembered], ...(this.state.deviceId !== null ? { error: this.missing ? 'Сохранённое устройство не отображается в списке. Проверьте звук.' : null } : {}) });
    } catch { if (generation === this.generation) this.update({ error: 'Не удалось получить список аудиовыходов.' }); }
  };
  private deviceChanged = (): void => {
    if (this.abort) { this.disconnected = true; this.abort.abort(); }
    void this.refresh();
  };
  public async select(deviceId: string): Promise<void> {
    const generation = ++this.generation;
    this.abort?.abort(); this.update({ busy: true, error: null });
    try {
      const result = await this.bridge?.selectDevice({ deviceId });
      if (generation !== this.generation) return;
      if (!result?.ok) throw new Error('Save failed');
      this.update({ deviceId: result.value.deviceId }); await this.refresh();
    } catch { if (generation === this.generation) this.update({ error: 'Не удалось сохранить аудиовыход. Попробуйте снова.' }); }
    finally { if (generation === this.generation) this.update({ busy: false }); }
  }
  public async play(speech: VoicePlaybackDTO, signal: AbortSignal): Promise<void> {
    const deviceId = this.state.deviceId;
    if (deviceId === null) throw new Error('Audio output preferences not ready');
    await this.refresh();
    const abort = new AbortController(); this.abort = abort; this.disconnected = false;
    const stop = () => abort.abort(); signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    try {
      await this.playback(speech, abort.signal, deviceId);
      if (this.disconnected && !signal.aborted) throw new Error('Audio output disconnected');
      if (!signal.aborted) this.update({ error: null });
    } catch (error) { if (!signal.aborted) this.update({ error: 'Звук не воспроизведён. Проверьте выбранный аудиовыход.' }); throw error; }
    finally { signal.removeEventListener('abort', stop); if (this.abort === abort) this.abort = undefined; }
  }
  public dispose(): void { this.generation++; this.abort?.abort(); this.media?.removeEventListener('devicechange', this.deviceChanged); }
}
