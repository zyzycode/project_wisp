import type { IVoiceInput } from '../ports/voice-input.port';
import type { VoiceCaptureContextDTO, VoiceInputResultDTO, VoiceModelStatusDTO, VoiceTranscribeDTO } from '../../shared/ipc-contracts';
interface Options {
  readonly adapter: IVoiceInput;
  readonly context: () => VoiceCaptureContextDTO | null;
  readonly createId: () => string;
  readonly schedule: (callback: () => void, delay: number) => () => void;
  readonly onDisabled?: () => void;
}
interface Capture {
  readonly requestId: string;
  readonly context: VoiceCaptureContextDTO;
  readonly abort: AbortController;
  release: () => void;
  phase: 'capture' | 'transcribe';
}
export class VoiceInputService {
  private capture: Capture | null = null;
  private readonly setup = new AbortController();
  private preparing = false;
  private disposed = false;
  private session: VoiceCaptureContextDTO | null = null;
  private outputBlocked = false;
  constructor(private readonly options: Options) {}
  private current(context: VoiceCaptureContextDTO): boolean {
    const current = this.options.context();
    return !this.disposed && current?.streamId === context.streamId && current.conversationId === context.conversationId;
  }
  public hasCaptureLease(): boolean { return this.session !== null && this.current(this.session); }
  public setOutputBlocked(blocked: boolean): void { this.outputBlocked = blocked; if (blocked) this.invalidate(); }
  public enable(context: VoiceCaptureContextDTO): VoiceInputResultDTO<null> {
    if (!this.current(context)) return { ok: false, code: 'stale_context' };
    if (this.preparing) return { ok: false, code: 'busy' };
    if (this.options.adapter.getStatus().state !== 'ready') return { ok: false, code: 'not_ready' };
    this.session = { ...context };
    return { ok: true, value: null };
  }
  public disable(): VoiceInputResultDTO<null> {
    const active = this.session !== null;
    this.session = null;
    this.invalidate();
    if (active) this.options.onDisabled?.();
    return { ok: true, value: null };
  }
  public readStatus(): VoiceInputResultDTO<VoiceModelStatusDTO> {
    return this.disposed ? { ok: false, code: 'unavailable' } : { ok: true, value: this.options.adapter.getStatus() };
  }
  public async prepare(): Promise<VoiceInputResultDTO<VoiceModelStatusDTO>> {
    if (this.disposed) return { ok: false, code: 'unavailable' };
    if (this.preparing || this.capture) return { ok: false, code: 'busy' };
    this.preparing = true;
    try { const result = await this.options.adapter.prepare(this.setup.signal); return result.ok ? this.readStatus() : result; }
    catch { return { ok: false, code: 'download_failed' }; }
    finally { this.preparing = false; }
  }
  public begin(context: VoiceCaptureContextDTO): VoiceInputResultDTO<{ readonly requestId: string }> {
    if (this.outputBlocked) return { ok: false, code: 'busy' };
    if (!this.current(context)) return { ok: false, code: 'stale_context' };
    if (!this.hasCaptureLease()) return { ok: false, code: 'cancelled' };
    if (this.capture || this.preparing) return { ok: false, code: 'busy' };
    if (this.options.adapter.getStatus().state !== 'ready') return { ok: false, code: 'not_ready' };
    const capture: Capture = { requestId: this.options.createId(), context, abort: new AbortController(), release: () => undefined, phase: 'capture' };
    this.capture = capture;
    capture.release = this.options.schedule(() => this.invalidate(), 45000);
    return { ok: true, value: { requestId: capture.requestId } };
  }
  public cancel(requestId: string): VoiceInputResultDTO<null> {
    if (this.capture?.requestId === requestId) this.invalidate();
    return { ok: true, value: null };
  }
  public invalidate(): void {
    const capture = this.capture; this.capture = null;
    capture?.release(); capture?.abort.abort();
  }
  public async transcribe(command: VoiceTranscribeDTO): Promise<VoiceInputResultDTO<{ readonly text: string }>> {
    if (this.outputBlocked) return { ok: false, code: 'busy' };
    const capture = this.capture;
    if (!capture || capture.requestId !== command.requestId || !this.current(command) || capture.context.streamId !== command.streamId || capture.context.conversationId !== command.conversationId) return { ok: false, code: 'stale_context' };
    if (capture.phase !== 'capture') return { ok: false, code: 'busy' };
    capture.release(); capture.phase = 'transcribe';
    let timedOut = false;
    capture.release = this.options.schedule(() => { timedOut = true; capture.abort.abort(); }, 60000);
    try {
      const result = await this.options.adapter.transcribe({ samples: Float32Array.from(command.samples), sampleRate: 16000, language: command.language }, capture.abort.signal);
      if (timedOut) return { ok: false, code: 'timeout' };
      if (this.capture !== capture || capture.abort.signal.aborted || !this.current(command)) return { ok: false, code: 'cancelled' };
      if (!result.ok) return result;
      const text = result.value.trim();
      if (!text) return { ok: false, code: 'empty_transcript' };
      if (text.length > 240) return { ok: false, code: 'text_too_long' };
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)) return { ok: false, code: 'recognition_failed' };
      return { ok: true, value: { text } };
    } catch { return { ok: false, code: timedOut ? 'timeout' : 'recognition_failed' }; }
    finally { capture.release(); if (this.capture === capture) this.capture = null; }
  }
  public async dispose(): Promise<void> { this.disposed = true; this.disable(); this.setup.abort(); await this.options.adapter.dispose(); }
}
