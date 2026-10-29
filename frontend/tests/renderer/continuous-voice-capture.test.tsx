import { afterEach, expect, it, vi } from 'vitest';
import { startContinuousVoiceCapture } from '../../src/renderer/continuous-voice-capture';

afterEach(() => vi.unstubAllGlobals());
it('stops a microphone granted after the user switched voice mode off', async () => {
  let grant!: (stream: Pick<MediaStream, 'getTracks'>) => void;
  const stop = vi.fn();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(() => new Promise(resolve => { grant = resolve; })) } });
  const abort = new AbortController();
  const pending = startContinuousVoiceCapture(abort.signal, vi.fn(), vi.fn());
  abort.abort(); grant({ getTracks: () => [{ stop }] as MediaStreamTrack[] });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(stop).toHaveBeenCalledOnce();
});
it('streams downsampled bounded blocks and releases every resource on device loss', async () => {
  let ended: (() => void) | undefined;
  const track = { stop: vi.fn(), addEventListener: vi.fn((_type: string, listener: () => void) => { ended = listener; }), removeEventListener: vi.fn() };
  const stream = { getTracks: () => [track] };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const processor: { onaudioprocess: ((event: { inputBuffer: { getChannelData(channel: number): Float32Array } }) => void) | null; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> } = {
    onaudioprocess: null, connect: vi.fn(), disconnect: vi.fn(),
  };
  const close = vi.fn(async () => undefined);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
  vi.stubGlobal('AudioContext', class {
    sampleRate = 48_000;
    destination = {};
    onstatechange: (() => void) | null = null;
    state = 'running';
    close = close;
    resume = vi.fn(async () => undefined);
    createMediaStreamSource() { return source; }
    createScriptProcessor() { return processor; }
  });
  const samples = vi.fn(); const failed = vi.fn();
  const capture = await startContinuousVoiceCapture(new AbortController().signal, samples, failed);
  processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(960).fill(0.2) } });
  expect(samples).toHaveBeenCalledOnce();
  expect(samples.mock.calls[0]?.[0]).toHaveLength(320);
  ended?.(); capture.cancel();
  expect(failed).toHaveBeenCalledOnce(); expect(track.stop).toHaveBeenCalledOnce();
  expect(processor.onaudioprocess).toBeNull(); expect(processor.disconnect).toHaveBeenCalledOnce();
  expect(source.disconnect).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
});
