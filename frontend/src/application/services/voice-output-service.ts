import type { ISpeechSynthesizer } from '../ports/reply-output.port';
import type { BrainStateDTO } from '../../shared/ipc-contracts';
import type { ReplyIdentityDTO, VoiceOutputResult, VoiceOutputStatusDTO, VoicePlaybackDTO } from '../../shared/voice-output-contracts';
import { parsePlayback } from '../../shared/voice-output-validation';
import type { IAudioOutputPreferences } from '../ports/audio-output-preferences';
interface Options {
  readonly preferences?: IAudioOutputPreferences;
  readonly synthesizer: ISpeechSynthesizer;
  readonly createId: () => string;
  readonly language: () => 'ru' | 'en';
  readonly blockInput: (blocked: boolean) => void;
  readonly revokeInput: () => void;
  readonly revokePlayback: () => void;
  readonly current?: () => Pick<BrainStateDTO, 'streamId' | 'dialogue' | 'autonomy'> | null;
}
interface Active {
  readonly id: string;
  readonly reply: ReplyIdentityDTO | null;
  readonly abort: AbortController;
  timer: ReturnType<typeof setTimeout>;
  timedOut: boolean;
}
const key = (reply: ReplyIdentityDTO) => JSON.stringify([reply.streamId, reply.conversationId, reply.requestId]);
/** Main owns admission, synthesis and the playback lease. Never accepts text from Renderer. */
export class VoiceOutputService {
  private snapshot: BrainStateDTO | null = null;
  private enabled = false;
  private ready = false;
  private disposed = false;
  private active: Active | null = null;
  private consumed: string | null = null;
  private startupPending = true;
  private deviceId = '';
  private current() { return this.options.current ? this.options.current() : this.snapshot; }
  constructor(private readonly options: Options) {}
  public async initialize(): Promise<void> {
    try { const ready = await this.options.synthesizer.ready(); if (!this.disposed) this.ready = ready; }
    catch { this.ready = false; }
  }
  public status(): VoiceOutputResult<VoiceOutputStatusDTO> {
    return this.disposed ? { ok: false, code: 'unavailable' } : { ok: true, value: { enabled: this.enabled, ready: this.ready, active: this.active !== null } };
  }
  public configure(enabled: boolean): VoiceOutputResult<VoiceOutputStatusDTO> {
    this.startupPending = false;
    if (this.disposed) return { ok: false, code: 'unavailable' };
    if (enabled && !this.ready) return { ok: false, code: 'unavailable' };
    this.enabled = enabled;
    if (!enabled) this.stop();
    // Enabling never replays an existing reply.
    const snapshot = this.current();
    if (snapshot?.dialogue.turn.phase === 'completed') this.consumed = key({ streamId: snapshot.streamId, conversationId: snapshot.dialogue.conversationId, requestId: snapshot.dialogue.turn.requestId });
    return this.status();
  }
  public configureAtStartup(): VoiceOutputResult<VoiceOutputStatusDTO> {
    if (!this.startupPending) return { ok: false, code: 'cancelled' };
    this.startupPending = false;
    return this.configure(true);
  }
  public async readDevice(): Promise<VoiceOutputResult<{ readonly deviceId: string }>> {
    const result = await this.options.preferences?.read();
    if (result && !result.ok) return { ok: false, code: 'storage_error' };
    if (result?.ok) this.deviceId = result.deviceId;
    return { ok: true, value: { deviceId: this.deviceId } };
  }
  public async selectDevice(deviceId: string): Promise<VoiceOutputResult<{ readonly deviceId: string }>> {
    const result = await this.options.preferences?.write(deviceId);
    if (result && !result.ok) return { ok: false, code: 'storage_error' };
    this.deviceId = deviceId; return { ok: true, value: { deviceId } };
  }
  public hasSelectedPlaybackLease(): boolean { return !this.disposed && this.active !== null && this.deviceId !== ''; }
  public testOutput(): VoiceOutputResult<VoicePlaybackDTO> {
    if (this.disposed) return { ok: false, code: 'unavailable' };
    this.stop();
    const id = this.options.createId();
    this.active = { id, reply: null, abort: new AbortController(), timedOut: false, timer: setTimeout(() => this.stop(), 2250) };
    this.options.blockInput(true);
    const samples = Float32Array.from({ length: 6000 }, (_, i) => 0.12 * Math.sin(2 * Math.PI * 440 * i / 24000) * Math.min(1, i / 240, (5999 - i) / 240));
    return { ok: true, value: { playbackId: id, sampleRate: 24000, samples } };
  }
  public observe(snapshot: BrainStateDTO): void {
    const previous = this.snapshot;
    this.snapshot = snapshot;
    if (previous && (previous.streamId !== snapshot.streamId || previous.dialogue.conversationId !== snapshot.dialogue.conversationId)) { this.enabled = false; this.consumed = null; this.stop(); }
    const active = this.active;
    if (active?.reply && !this.matches(active.reply)) this.stop();
  }
  private matches(reply: ReplyIdentityDTO): boolean {
    const s = this.current();
    return !this.disposed && s !== null && !s.autonomy?.quiet && s.streamId === reply.streamId && s.dialogue.conversationId === reply.conversationId && s.dialogue.turn.phase === 'completed' && s.dialogue.turn.outcome.kind === 'success' && s.dialogue.turn.requestId === reply.requestId;
  }
  public async speak(reply: ReplyIdentityDTO): Promise<VoiceOutputResult<VoicePlaybackDTO>> {
    if (!this.enabled) return { ok: false, code: 'disabled' };
    if (!this.ready || this.disposed) return { ok: false, code: 'unavailable' };
    if (!this.matches(reply)) return { ok: false, code: 'stale' };
    const identity = key(reply);
    if (this.consumed === identity) return { ok: false, code: 'consumed' };
    this.stop(); this.consumed = identity;
    const turn = this.current()?.dialogue.turn;
    if (turn?.phase !== 'completed') return { ok: false, code: 'stale' };
    const active: Active = { id: this.options.createId(), reply: { ...reply }, abort: new AbortController(), timedOut: false, timer: setTimeout(() => { active.timedOut = true; this.failSynthesis(active); }, 120_000) };
    this.active = active;
    this.options.blockInput(true);
    try {
      const speech = await this.options.synthesizer.synthesize(turn.replyText, this.options.language(), active.abort.signal);
      if (this.active !== active || active.abort.signal.aborted || !this.matches(reply)) return { ok: false, code: active.timedOut ? 'timeout' : 'cancelled' };
      const playback = parsePlayback({ playbackId: active.id, ...speech });
      clearTimeout(active.timer);
      active.timer = setTimeout(() => this.stop(), playback.samples.length / 24 + 2000);
      return { ok: true, value: playback };
    } catch {
      if (this.active !== active) return { ok: false, code: active.timedOut ? 'timeout' : 'cancelled' };
      this.failSynthesis(active); return { ok: false, code: 'synthesis_failed' };
    }
  }
  private failSynthesis(active: Active): void {
    if (this.active !== active) return;
    clearTimeout(active.timer); active.abort.abort(); this.active = null;
    // No PCM was delivered: report the failure without a playback-revoke race.
    this.options.revokeInput(); this.options.blockInput(false);
  }
  public acknowledge(playbackId: string): VoiceOutputResult<null> {
    if (this.active?.id === playbackId) {
      clearTimeout(this.active.timer); this.active.abort.abort(); this.active = null;
      this.options.blockInput(false);
    }
    return { ok: true, value: null };
  }
  public stop(): VoiceOutputResult<null> {
    const active = this.active; this.active = null;
    if (active) {
      clearTimeout(active.timer); active.abort.abort();
      // Without a playback acknowledgement, microphone consent cannot safely resume.
      this.options.revokeInput(); this.options.revokePlayback(); this.options.blockInput(false);
    }
    return { ok: true, value: null };
  }
  public reset(): void { this.startupPending = false; this.enabled = false; this.stop(); this.snapshot = null; this.consumed = null; }
  public async dispose(): Promise<void> { this.disposed = true; this.reset(); await this.options.synthesizer.dispose(); }
}
