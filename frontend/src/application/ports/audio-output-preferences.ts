export type AudioOutputPreferenceResult = { readonly ok: true; readonly deviceId: string } | { readonly ok: false };
export interface IAudioOutputPreferences {
  read(): Promise<AudioOutputPreferenceResult>;
  write(deviceId: string): Promise<AudioOutputPreferenceResult>;
}
