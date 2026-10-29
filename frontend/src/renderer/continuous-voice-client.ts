import type { VoiceCaptureContextDTO, VoiceInputApiBridge, VoiceInputErrorDTO } from '../shared/ipc-contracts';
import { startContinuousVoiceCapture, type ContinuousVoiceCapture, type StartContinuousVoiceCapture } from './continuous-voice-capture';
import { VoiceActivityDetector } from './voice-activity-detector';

export interface ContinuousVoiceState {
  readonly enabled: boolean;
  readonly phase: 'off' | 'starting' | 'listening' | 'transcribing' | 'sending' | 'paused';
  readonly error: string | null;
}
const errorMessage = (code: VoiceInputErrorDTO): string => {
  if (code === 'not_ready' || code === 'integrity_failed') return 'Модель голоса отсутствует или повреждена. Переустановите Wisp.';
  if (code === 'text_too_long') return 'Реплика длиннее 240 символов. Скажите короче.';
  if (code === 'timeout') return 'Распознавание заняло слишком долго. Повторите короткую фразу.';
  if (code === 'stale_context' || code === 'cancelled') return 'Диалог изменился. Включите микрофон снова.';
  return 'Не удалось распознать речь. Повторите фразу или выключите микрофон.';
};

/** Input lifecycle only: auto-submission still passes through the existing validated Dialogue command. */
export class ContinuousVoiceClient {
  private state: ContinuousVoiceState = { enabled: false, phase: 'off', error: null };
  private readonly listeners = new Set<() => void>();
  private readonly detector = new VoiceActivityDetector();
  private context: VoiceCaptureContextDTO | null = null;
  private canSubmit = false;
  private generation = 0;
  private utterance = 0;
  private language: 'ru' | 'en' = 'ru';
  private abort?: AbortController;
  private capture?: ContinuousVoiceCapture;
  private requestId?: string;
  private unsubscribe?: () => void;
  constructor(private readonly bridge: VoiceInputApiBridge | undefined,
    private readonly submit: (text: string) => Promise<boolean>,
    private readonly startCapture: StartContinuousVoiceCapture = startContinuousVoiceCapture) {}

  public getSnapshot = (): ContinuousVoiceState => this.state;
  public subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(change: Partial<ContinuousVoiceState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
  public setContext(context: VoiceCaptureContextDTO | null): void {
    if (context?.streamId === this.context?.streamId && context?.conversationId === this.context?.conversationId) return;
    if (this.state.enabled) this.disable();
    this.context = context;
  }
  public setCanSubmit(canSubmit: boolean): void {
    if (canSubmit === this.canSubmit) return;
    this.canSubmit = canSubmit;
    this.detector.reset();
    if (!this.state.enabled || this.state.phase === 'starting' || this.state.phase === 'sending') return;
    if (!canSubmit) this.cancelUtterance();
    if (this.state.phase !== 'transcribing' || !canSubmit) this.update({ phase: canSubmit ? 'listening' : 'paused' });
  }
  public async enable(language: 'ru' | 'en' = 'ru'): Promise<void> {
    if (this.state.enabled || !this.bridge || !this.context) return;
    const generation = ++this.generation;
    this.language = language;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.update({ enabled: true, phase: 'starting', error: null });
    this.unsubscribe = this.bridge.onDisabled(() => this.stop(false));
    try {
      const status = await this.bridge.readStatus();
      if (generation !== this.generation) return;
      if (!status.ok || status.value.state !== 'ready') {
        this.fail(errorMessage(status.ok ? 'not_ready' : status.code)); return;
      }
      const result = await this.bridge.enable(this.context);
      if (generation !== this.generation) {
        // A delayed acknowledgement must not leave an off session authorized in Main.
        if (result.ok && !this.state.enabled) void this.bridge.disable().catch(() => undefined);
        return;
      }
      if (!result.ok) { this.fail(errorMessage(result.code)); return; }
      const capture = await this.startCapture(signal, samples => {
        if (generation === this.generation) this.accept(samples);
      }, () => {
        if (generation === this.generation) this.fail('Микрофон отключён. Проверьте подключение и включите его снова.');
      });
      if (generation !== this.generation) { capture.cancel(); return; }
      this.capture = capture;
      this.update({ phase: this.canSubmit ? 'listening' : 'paused' });
    } catch (error) {
      if (generation !== this.generation) return;
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      this.fail(denied ? 'Нет доступа к микрофону. Разрешите его в настройках системы.' : 'Микрофон недоступен. Проверьте подключение и попробуйте снова.');
    }
  }
  public disable(): void { this.stop(true); }
  private stop(notifyMain: boolean): void {
    const enabled = this.state.enabled;
    this.generation++;
    this.cancelUtterance();
    try { this.capture?.cancel(); } catch { /* Continue revoking the mode after browser teardown errors. */ }
    this.capture = undefined;
    this.abort?.abort(); this.abort = undefined;
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.update({ enabled: false, phase: 'off', error: null });
    if (enabled && notifyMain) void this.bridge?.disable().catch(() => undefined);
  }
  private fail(error: string): void { this.disable(); this.update({ error }); }
  private cancelUtterance(): void {
    this.utterance++;
    this.detector.reset();
    const requestId = this.requestId; this.requestId = undefined;
    if (requestId) void this.bridge?.cancel({ requestId }).catch(() => undefined);
  }
  private accept(samples: Float32Array): void {
    if (!this.state.enabled || this.state.phase !== 'listening' || !this.canSubmit) { this.detector.reset(); return; }
    for (const phrase of this.detector.append(samples)) {
      if (this.state.phase !== 'listening') break;
      void this.recognize(phrase);
    }
  }
  private async recognize(samples: readonly number[]): Promise<void> {
    if (!this.bridge || !this.context) return;
    const bridge = this.bridge;
    const context = this.context;
    const generation = this.generation;
    const utterance = ++this.utterance;
    const current = () => generation === this.generation && utterance === this.utterance && this.state.enabled;
    this.detector.reset();
    this.update({ phase: 'transcribing', error: null });
    try {
      const lease = await bridge.begin(context);
      if (!current()) {
        if (lease.ok) void bridge.cancel({ requestId: lease.value.requestId }).catch(() => undefined);
        return;
      }
      if (!lease.ok) {
        if (lease.code === 'stale_context' || lease.code === 'not_ready' || lease.code === 'unavailable') this.fail(errorMessage(lease.code));
        else this.update({ error: errorMessage(lease.code) });
        return;
      }
      this.requestId = lease.value.requestId;
      const result = await bridge.transcribe({ ...context, requestId: lease.value.requestId, language: this.language, samples });
      if (!current() || !this.canSubmit) return;
      this.requestId = undefined;
      if (!result.ok) {
        if (result.code !== 'empty_transcript') this.update({ error: errorMessage(result.code) });
        return;
      }
      const text = result.value.text.trim();
      if (!text) return;
      if (text.length > 240) { this.update({ error: errorMessage('text_too_long') }); return; }
      this.update({ phase: 'sending' });
      const accepted = await this.submit(text);
      if (current() && !accepted) this.update({ error: 'Сообщение не отправлено. Проверьте соединение и повторите фразу.' });
    } catch {
      if (current()) {
        const requestId = this.requestId; this.requestId = undefined;
        if (requestId) void bridge.cancel({ requestId }).catch(() => undefined);
        this.update({ error: errorMessage('recognition_failed') });
      }
    } finally {
      if (current()) { this.detector.reset(); this.update({ phase: this.canSubmit ? 'listening' : 'paused' }); }
    }
  }
}
