export interface ReplyIdentityDTO {
  readonly streamId: string;
  readonly conversationId: string;
  readonly requestId: string;
}
export interface VoiceOutputStatusDTO {
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly active: boolean;
}
export interface VoicePlaybackDTO {
  readonly playbackId: string;
  readonly sampleRate: 24000;
  readonly samples: Float32Array;
}
export type VoiceOutputError = 'invalid_request' | 'unavailable' | 'disabled' | 'stale' | 'consumed' | 'cancelled' | 'timeout' | 'synthesis_failed' | 'storage_error';
export type VoiceOutputResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: VoiceOutputError };
export interface VoiceOutputBridge {
  configureAtStartup(): Promise<VoiceOutputResult<VoiceOutputStatusDTO>>;
  readDevice(): Promise<VoiceOutputResult<{ readonly deviceId: string }>>;
  selectDevice(command: { readonly deviceId: string }): Promise<VoiceOutputResult<{ readonly deviceId: string }>>;
  test(): Promise<VoiceOutputResult<VoicePlaybackDTO>>;
  readStatus(): Promise<VoiceOutputResult<VoiceOutputStatusDTO>>;
  configure(command: { readonly enabled: boolean }): Promise<VoiceOutputResult<VoiceOutputStatusDTO>>;
  speak(command: ReplyIdentityDTO): Promise<VoiceOutputResult<VoicePlaybackDTO>>;
  stop(): Promise<VoiceOutputResult<null>>;
  acknowledge(command: { readonly playbackId: string }): Promise<VoiceOutputResult<null>>;
  onRevoked(listener: () => void): () => void;
}
export const MAX_VOICE_SAMPLES = 2_880_000;
