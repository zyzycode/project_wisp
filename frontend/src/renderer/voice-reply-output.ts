import type { IReplyOutput, ReplyPresentation, ReplyOutputOutcome } from './reply-output';
import type { VoiceOutputBridge } from '../shared/voice-output-contracts';
export interface VoiceReplyState {
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly phase: 'off' | 'idle' | 'preparing' | 'speaking';
  readonly error: string | null;
}
import { AudioOutputRoute } from './audio-output-route';
import type { PlaySpeech } from './audio-playback';
/** Audio is presentation only; authoritative reply admission and synthesis stay in Main. */
export class VoiceReplyOutput implements IReplyOutput {
  private state: VoiceReplyState = { enabled: false, ready: false, phase: 'off', error: null };
  private readonly listeners = new Set<() => void>();
  private abort?: AbortController;
  private generation = 0;
  private disposed = false;
  private unsubscribe?: () => void;
  public readonly audio: AudioOutputRoute;
  constructor(private readonly bridge: VoiceOutputBridge | undefined, play?: PlaySpeech) { this.audio = new AudioOutputRoute(bridge, undefined, play); }
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
      await this.audio.initialize();
      const result = await this.bridge?.readStatus();
      if (!this.disposed && generation === this.generation && result?.ok) this.update({ enabled: result.value.enabled, ready: result.value.ready, phase: result.value.enabled ? 'idle' : 'off' });
    } catch { if (!this.disposed) this.update({ error: 'Озвучка недоступна. Ответы останутся текстовыми.' }); }
  }
  public async configureAtStartup(): Promise<void> {
    if (this.disposed || !this.bridge) return;
    const generation = this.generation;
    try { const result = await this.bridge.configureAtStartup(); if (!this.disposed && generation === this.generation && result.ok) this.update({ enabled: result.value.enabled, ready: result.value.ready, phase: 'idle' }); } catch { /* Explicit controls remain available. */ }
  }
  public async selectDevice(deviceId: string): Promise<void> { this.clear(); await this.audio.select(deviceId); }
  public test(): Promise<ReplyOutputOutcome> { return this.perform(undefined); }
  public async configure(enabled: boolean): Promise<void> {
    if (!enabled) this.clear();
    try {
      const result = await this.bridge?.configure({ enabled });
      if (this.disposed) return;
      if (result?.ok) this.update({ enabled: result.value.enabled, ready: result.value.ready, phase: result.value.enabled ? 'idle' : 'off', error: null });
      else this.update({ enabled: false, phase: 'off', error: 'Озвучка недоступна. Ответы останутся текстовыми.' });
    } catch { if (!this.disposed) this.update({ error: 'Не удалось включить озвучку.' }); }
  }
  public submit(reply: ReplyPresentation): Promise<ReplyOutputOutcome> { return this.perform(reply); }
  private async perform(reply: ReplyPresentation | undefined): Promise<ReplyOutputOutcome> {
    if ((reply && !this.state.enabled) || this.disposed || !this.bridge) return 'cancelled';
    this.cancel(true);
    const generation = ++this.generation;
    const abort = new AbortController(); this.abort = abort;
    this.update({ phase: 'preparing', error: null });
    const bridge = this.bridge;
    try {
      const result = await (reply ? bridge.speak({ streamId: reply.streamId, conversationId: reply.conversationId, requestId: reply.requestId }) : bridge.test());
      if (!result.ok) {
        if (generation !== this.generation || ['cancelled', 'stale', 'consumed', 'disabled'].includes(result.code)) return 'cancelled';
        this.update({ error: 'Не удалось озвучить ответ. Текст доступен в чате.' });
        return 'failed';
      }
      if (generation !== this.generation || this.disposed) { await bridge.acknowledge({ playbackId: result.value.playbackId }); return 'cancelled'; }
      this.update({ phase: 'speaking' });
      try { await this.audio.play(result.value, abort.signal); }
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
  public dispose(): void { this.disposed = true; this.clear(); this.unsubscribe?.(); this.unsubscribe = undefined; this.audio.dispose(); }
}
