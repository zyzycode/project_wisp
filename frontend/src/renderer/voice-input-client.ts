import type { VoiceCaptureContextDTO, VoiceInputApiBridge, VoiceInputErrorDTO, VoiceModelStatusDTO } from '../shared/ipc-contracts';
import { startVoiceCapture, type StartVoiceCapture, type VoiceCapture } from './voice-pcm-capture';

export interface VoiceInputState {
  readonly phase: 'idle' | 'starting' | 'recording' | 'transcribing';
  readonly model: VoiceModelStatusDTO | null;
  readonly error: string | null;
}
const errors: Record<VoiceInputErrorDTO, string> = {
  unavailable: 'Голосовой ввод недоступен. Можно написать сообщение.',
  not_ready: 'Сначала загрузите модель распознавания.', busy: 'Голосовой ввод уже занят. Попробуйте ещё раз.',
  cancelled: 'Запись отменена.', timeout: 'Распознавание заняло слишком долго. Попробуйте короткую запись.',
  download_failed: 'Не удалось загрузить модель. Проверьте подключение и повторите.',
  integrity_failed: 'Модель повреждена. Повторите загрузку.', invalid_audio: 'Не удалось получить звук. Повторите запись.',
  recognition_failed: 'Не удалось распознать речь. Повторите запись.', invalid_request: 'Не удалось начать запись. Повторите попытку.',
  stale_context: 'Диалог изменился. Повторите запись.', text_too_long: 'Получилось больше 240 символов. Запишите короче.',
  empty_transcript: 'Речь не распознана. Повторите запись.',
};

/** Presentation lifecycle only: never submits a message or changes dialogue state. */
export class VoiceInputClient {
  private state: VoiceInputState = { phase: 'idle', model: null, error: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  private context: VoiceCaptureContextDTO | null = null;
  private capture?: VoiceCapture;
  private abort?: AbortController;
  private requestId?: string;
  private language: 'ru' | 'en' = 'ru';
  private poll?: ReturnType<typeof setInterval>;
  private statusGeneration = 0;
  private preparing = false;
  constructor(private readonly bridge: VoiceInputApiBridge | undefined,
    private readonly acceptDraft: (text: string) => void,
    private readonly startCapture: StartVoiceCapture = startVoiceCapture) {}
  getSnapshot = (): VoiceInputState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(change: Partial<VoiceInputState>): void {
    this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener());
  }
  activate(context: VoiceCaptureContextDTO | null): void {
    this.deactivate(); this.context = context;
    if (context) { void this.refresh(); this.poll = setInterval(() => { void this.refresh(); }, 700); }
  }
  deactivate(): void {
    this.context = null; this.statusGeneration++; clearInterval(this.poll); this.cancel();
  }
  private async refresh(): Promise<void> {
    if (!this.bridge || !this.context) return;
    const generation = this.statusGeneration;
    try {
      const result = await this.bridge.readStatus();
      if (generation !== this.statusGeneration || !this.context) return;
      if (result.ok) {
        this.update({ model: result.value });
        if (result.value.state !== 'downloading' && !this.preparing) clearInterval(this.poll);
      }
      else this.statusError(errors[result.code]);
    } catch { if (generation === this.statusGeneration) this.statusError(errors.unavailable); }
  }
  private statusError(error: string): void {
    if (!this.preparing) clearInterval(this.poll);
    this.update({ error, model: { state: 'error', downloadedBytes: 0, totalBytes: this.state.model?.totalBytes ?? 0 } });
  }
  async prepare(): Promise<void> {
    if (!this.bridge || this.preparing) return;
    this.preparing = true;
    clearInterval(this.poll);
    this.poll = setInterval(() => { void this.refresh(); }, 700);
    const generation = this.statusGeneration;
    this.update({ error: null, model: { state: 'downloading', downloadedBytes: 0, totalBytes: this.state.model?.totalBytes ?? 0 } });
    try {
      const result = await this.bridge.prepare();
      if (generation === this.statusGeneration && this.context) {
        if (result.ok) this.update({ model: result.value });
        else this.update({ error: errors[result.code] });
      }
    } catch { if (generation === this.statusGeneration) this.update({ error: errors.download_failed }); }
    finally { this.preparing = false; void this.refresh(); }
  }
  async start(language: 'ru' | 'en'): Promise<void> {
    if (!this.bridge || !this.context || this.state.phase !== 'idle') return;
    const context = this.context;
    const generation = ++this.generation;
    this.language = language;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.update({ phase: 'starting', error: null });
    try {
      const result = await this.bridge.begin(context);
      if (generation !== this.generation) {
        if (result.ok) void this.bridge.cancel({ requestId: result.value.requestId }).catch(() => undefined);
        return;
      }
      if (!result.ok) { this.update({ phase: 'idle', error: errors[result.code] }); return; }
      this.requestId = result.value.requestId;
      const capture = await this.startCapture(signal, () => { void this.stop(); });
      if (generation !== this.generation) { capture.cancel(); return; }
      this.capture = capture;
      this.update({ phase: 'recording' });
    } catch (error) {
      if (generation !== this.generation) return;
      this.cancel();
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      this.update({ error: denied ? 'Нет доступа к микрофону. Разрешите его в настройках системы или напишите сообщение.' : 'Микрофон недоступен. Проверьте подключение или напишите сообщение.' });
    }
  }
  async stop(): Promise<void> {
    if (!this.bridge || !this.context || !this.capture || !this.requestId || this.state.phase !== 'recording') return;
    const generation = this.generation;
    const requestId = this.requestId;
    try {
      const samples = this.capture.stop(); this.capture = undefined;
      this.update({ phase: 'transcribing' });
      const result = await this.bridge.transcribe({ ...this.context, requestId, language: this.language, samples });
      if (generation !== this.generation) return;
      this.requestId = undefined;
      if (!result.ok) { this.update({ phase: 'idle', error: errors[result.code] }); return; }
      const text = result.value.text.trim();
      if (!text || text.length > 240) { this.update({ phase: 'idle', error: errors[text ? 'text_too_long' : 'empty_transcript'] }); return; }
      this.update({ phase: 'idle', error: null }); this.acceptDraft(text);
    } catch { if (generation === this.generation) { this.cancel(); this.update({ error: errors.recognition_failed }); } }
  }
  cancel(): void {
    this.generation++;
    this.capture?.cancel(); this.capture = undefined;
    this.abort?.abort(); this.abort = undefined;
    const requestId = this.requestId; this.requestId = undefined;
    if (requestId) void this.bridge?.cancel({ requestId }).catch(() => undefined);
    this.update({ phase: 'idle', error: null });
  }
}
