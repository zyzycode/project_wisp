/** Local speech recognition; no chat submission or character semantics. */
export type VoiceInputFailure =
  | 'unavailable' | 'not_ready' | 'busy' | 'cancelled' | 'timeout'
  | 'download_failed' | 'integrity_failed' | 'invalid_audio' | 'recognition_failed';

export type VoiceInputResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: VoiceInputFailure };

export interface VoiceModelStatus {
  readonly state: 'not_installed' | 'downloading' | 'ready' | 'error';
  readonly downloadedBytes: number;
  readonly totalBytes: number;
}

export interface VoiceAudioInput {
  readonly samples: Float32Array;
  readonly sampleRate: 16000;
  readonly language: 'ru' | 'en';
}

/** Main creates the adapter; download and compute have separate cancellation scopes. */
export interface IVoiceInput {
  getStatus(): VoiceModelStatus;
  prepare(signal: AbortSignal): Promise<VoiceInputResult<void>>;
  transcribe(audio: VoiceAudioInput, signal: AbortSignal): Promise<VoiceInputResult<string>>;
  dispose(): Promise<void>;
}
