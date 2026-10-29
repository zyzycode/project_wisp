import { MonoPcmCollector } from './voice-pcm-capture';

export interface ContinuousVoiceCapture { cancel(): void }
export type StartContinuousVoiceCapture = (
  signal: AbortSignal,
  onSamples: (samples: Float32Array) => void,
  onError: () => void,
) => Promise<ContinuousVoiceCapture>;

/** Keeps only a single browser audio block; segmentation and admission belong to the client. */
export const startContinuousVoiceCapture: StartContinuousVoiceCapture = async (signal, onSamples, onError) => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const stopTracks = () => {
    for (const track of stream.getTracks()) { try { track.stop(); } catch { /* Release remaining tracks too. */ } }
  };
  if (signal.aborted) { stopTracks(); throw new DOMException('Cancelled', 'AbortError'); }
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: ScriptProcessorNode | undefined;
  let ended = false;
  const cleanup = () => {
    if (ended) return;
    ended = true;
    signal.removeEventListener('abort', cleanup);
    for (const track of stream.getTracks()) track.removeEventListener('ended', failed);
    stopTracks();
    if (processor) { processor.onaudioprocess = null; try { processor.disconnect(); } catch { /* Already disconnected. */ } }
    try { source?.disconnect(); } catch { /* Already disconnected. */ }
    if (context) context.onstatechange = null;
    void context?.close().catch(() => undefined);
  };
  const failed = () => { if (!ended) { cleanup(); onError(); } };
  signal.addEventListener('abort', cleanup, { once: true });
  for (const track of stream.getTracks()) track.addEventListener('ended', failed, { once: true });
  try {
    context = new AudioContext({ sampleRate: 16_000 });
    const pcm = new MonoPcmCollector(context.sampleRate);
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = event => {
      if (ended) return;
      pcm.append(event.inputBuffer.getChannelData(0));
      onSamples(Float32Array.from(pcm.take()));
    };
    context.onstatechange = () => { if (context?.state === 'closed') failed(); };
    source.connect(processor);
    processor.connect(context.destination);
    await context.resume();
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    return { cancel: cleanup };
  } catch (error) { cleanup(); throw error; }
};
