/** Browser input only. Audio never leaves this process except through the typed voice bridge. */
export interface VoiceCapture {
  stop(): readonly number[];
  cancel(): void;
}
export type StartVoiceCapture = (signal: AbortSignal, onLimit: () => void) => Promise<VoiceCapture>;

/** Area-average downsampling preserves continuity across browser audio blocks. */
export class MonoPcmCollector {
  private readonly samples: number[] = [];
  private weight = 0;
  private sum = 0;
  constructor(private readonly sampleRate: number, private readonly limit = 480_000) {}
  append(input: Float32Array): boolean {
    const width = this.sampleRate / 16_000;
    for (const sample of input) {
      let remaining = 1;
      while (remaining > 0 && this.samples.length < this.limit) {
        const take = Math.min(remaining, width - this.weight);
        this.sum += (Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0) * take;
        this.weight += take;
        remaining -= take;
        if (this.weight >= width - 1e-9) {
          this.samples.push(this.sum / width);
          this.sum = 0;
          this.weight = 0;
        }
      }
      if (this.samples.length >= this.limit) return true;
    }
    return false;
  }
  take(): readonly number[] { return this.samples.splice(0); }
}

export const startVoiceCapture: StartVoiceCapture = async (signal, onLimit) => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const stopTracks = () => stream.getTracks().forEach(track => track.stop());
  if (signal.aborted) { stopTracks(); throw new DOMException('Cancelled', 'AbortError'); }
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: ScriptProcessorNode | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ended = false;
  const collector = new MonoPcmCollector(16_000);
  const cleanup = () => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', cleanup);
    stopTracks();
    if (processor) { processor.onaudioprocess = null; processor.disconnect(); }
    source?.disconnect();
    void context?.close().catch(() => undefined);
  };
  signal.addEventListener('abort', cleanup, { once: true });
  try {
    context = new AudioContext({ sampleRate: 16_000 });
    const pcm = context.sampleRate === 16_000 ? collector : new MonoPcmCollector(context.sampleRate);
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = event => {
      if (!ended && pcm.append(event.inputBuffer.getChannelData(0))) onLimit();
    };
    source.connect(processor);
    processor.connect(context.destination); // Output buffer remains silent; no microphone feedback.
    await context.resume();
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    timer = setTimeout(onLimit, 30_000);
    return { stop: () => { cleanup(); return pcm.take(); }, cancel: () => { cleanup(); pcm.take(); } };
  } catch (error) { cleanup(); throw error; }
};
