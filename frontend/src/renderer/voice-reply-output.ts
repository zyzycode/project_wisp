import type { IReplyOutput, ReplyPresentation, ReplyOutputOutcome } from './reply-output';
import type { VoiceOutputBridge, VoicePlaybackDTO } from '../shared/voice-output-contracts';
export interface VoiceReplyState {
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly phase: 'off' | 'idle' | 'preparing' | 'speaking';
  readonly error: string | null;
}
export type PlaySpeech = (speech: VoicePlaybackDTO, signal: AbortSignal) => Promise<void>;
/** Audio is presentation only; authoritative reply admission and synthesis stay in Main. */
export class VoiceReplyOutput implements IReplyOutput {
  private state: VoiceReplyState = { enabled: false, ready: false, phase: 'off', error: null };
  private readonly listeners = new Set<() => void>();
  private abort?: AbortController;
  private generation = 0;
  private disposed = false;
  private unsubscribe?: () => void;
  constructor(private readonly bridge: VoiceOutputBridge | undefined, private readonly play: PlaySpeech = playSpeech) {}
  public getSnapshot = (): VoiceReplyState => this.state;
  public subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(change: Partial<VoiceReplyState>): void { this.state = { ...this.state, ...change }; for (const listener of this.listeners) listener(); }
  public async initialize(): Promise<void> {
    this.disposed = false;
    this.unsubscribe = this.bridge?.onRevoked(() => {
      this.cancel(false);
      const generation = this.generation;
      void this.bridge?.readStatus().then(result => {
        if (!this.disposed && generation === this.generation && result.ok) this.update({ enabled: result.value.enabled, phase: result.value.enabled ? 'idle' : 'off' });
      }).catch(() => undefined);
    });
    const generation = this.generation;
    try {
      const result = await this.bridge?.readStatus();
      if (!this.disposed && generation === this.generation && result?.ok) this.update({ enabled: result.value.enabled, ready: result.value.ready, phase: result.value.enabled ? 'idle' : 'off' });
    } catch { if (!this.disposed) this.update({ error: 'Озвучка недоступна. Ответы останутся текстовыми.' }); }
  }
  public async configure(enabled: boolean): Promise<void> {
    if (!enabled) this.clear();
    try {
      const result = await this.bridge?.configure({ enabled });
      if (this.disposed) return;
      if (result?.ok) this.update({ enabled: result.value.enabled, ready: result.value.ready, phase: result.value.enabled ? 'idle' : 'off', error: null });
      else this.update({ enabled: false, phase: 'off', error: 'Озвучка недоступна. Ответы останутся текстовыми.' });
    } catch { if (!this.disposed) this.update({ error: 'Не удалось включить озвучку.' }); }
  }
  public async submit(reply: ReplyPresentation): Promise<ReplyOutputOutcome> {
    if (!this.state.enabled || this.disposed || !this.bridge) return 'cancelled';
    this.cancel(true);
    const generation = ++this.generation;
    const abort = new AbortController(); this.abort = abort;
    this.update({ phase: 'preparing', error: null });
    const bridge = this.bridge;
    try {
      const result = await bridge.speak({ streamId: reply.streamId, conversationId: reply.conversationId, requestId: reply.requestId });
      if (!result.ok) {
        if (generation !== this.generation || ['cancelled', 'stale', 'consumed', 'disabled'].includes(result.code)) return 'cancelled';
        this.update({ error: 'Не удалось озвучить ответ. Текст доступен в чате.' });
        return 'failed';
      }
      if (generation !== this.generation || this.disposed) { await bridge.acknowledge({ playbackId: result.value.playbackId }); return 'cancelled'; }
      this.update({ phase: 'speaking' });
      try { await this.play(result.value, abort.signal); }
      finally { await bridge.acknowledge({ playbackId: result.value.playbackId }); }
      return generation === this.generation ? 'presented' : 'cancelled';
    } catch {
      if (generation !== this.generation || this.disposed) return 'cancelled';
      this.update({ error: 'Не удалось воспроизвести ответ. Текст доступен в чате.' });
      return 'failed';
    } finally {
      if (generation === this.generation) { this.abort = undefined; this.update({ phase: this.state.enabled ? 'idle' : 'off' }); }
    }
  }
  private cancel(notify: boolean): void {
    this.generation++; this.abort?.abort(); this.abort = undefined;
    this.update({ phase: this.state.enabled ? 'idle' : 'off' });
    if (notify) void this.bridge?.stop().catch(() => undefined);
  }
  public clear(): void { this.cancel(true); }
  public dispose(): void { this.disposed = true; this.clear(); this.unsubscribe?.(); this.unsubscribe = undefined; }
}
export async function playSpeech(speech: VoicePlaybackDTO, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  const context = new AudioContext({ sampleRate: speech.sampleRate });
  try {
    await new Promise<void>((resolve, reject) => {
      const source = context.createBufferSource();
      const buffer = context.createBuffer(1, speech.samples.length, speech.sampleRate);
      buffer.copyToChannel(new Float32Array(speech.samples), 0);
      source.buffer = buffer; source.connect(context.destination);
      const stop = () => { try { source.stop(); } catch { /* Already ended. */ } resolve(); };
      signal.addEventListener('abort', stop, { once: true });
      source.onended = () => { signal.removeEventListener('abort', stop); resolve(); };
      void context.resume().then(() => { if (signal.aborted) stop(); else source.start(); }, reject);
    });
  } finally { await context.close(); }
}
