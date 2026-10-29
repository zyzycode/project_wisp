import type { VoicePlaybackDTO } from '../shared/voice-output-contracts';
export type PlaySpeech = (speech: VoicePlaybackDTO, signal: AbortSignal, deviceId?: string) => Promise<void>;
export async function playSpeech(speech: VoicePlaybackDTO, signal: AbortSignal, deviceId = ''): Promise<void> {
  if (signal.aborted) return;
  const context = new AudioContext({ sampleRate: speech.sampleRate });
  try {
    if (deviceId) {
      if (!('setSinkId' in context) || typeof context.setSinkId !== 'function') throw new Error('Audio output selection unavailable');
      await context.setSinkId(deviceId);
    }
    if (signal.aborted) return;
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
