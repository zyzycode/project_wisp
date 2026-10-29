/** Local synthesis only; presentation channels are consumed in Renderer. */
export interface SynthesizedSpeech {
  readonly sampleRate: 24000;
  readonly samples: Float32Array;
}
export interface ISpeechSynthesizer {
  ready(): Promise<boolean>;
  synthesize(text: string, language: 'ru' | 'en', signal: AbortSignal): Promise<SynthesizedSpeech>;
  dispose(): Promise<void>;
}
