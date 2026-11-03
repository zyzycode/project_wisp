import { expect, it, vi } from 'vitest';
import { AudioOutputRoute } from '../../src/renderer/audio-output-route';
import { playSpeech } from '../../src/renderer/audio-playback';
import type { PlaySpeech } from '../../src/renderer/audio-playback';
import type { VoiceOutputBridge } from '../../src/shared/voice-output-contracts';
const speech = { playbackId: 'test', sampleRate: 24000 as const, samples: new Float32Array([0.1]) };
function fixture() {
  let devices = ['speaker']; let changed: () => void = () => undefined;
  const media = { enumerateDevices: async () => devices.map(deviceId => ({ deviceId, label: 'Speakers', kind: 'audiooutput' })), addEventListener: (_type: string, listener: () => void) => { changed = listener; }, removeEventListener: vi.fn() };
  const bridge = { readDevice: async () => ({ ok: true, value: { deviceId: 'speaker' } }), selectDevice: async ({ deviceId }: { deviceId: string }) => ({ ok: true, value: { deviceId } }) } as VoiceOutputBridge;
  const play = vi.fn<PlaySpeech>(async () => undefined);
  const route = new AudioOutputRoute(bridge, media as MediaDevices, play);
  const changeDevices = async (next: string[]) => { devices = next; changed(); await route.refresh(); };
  return { route, play, changeDevices, disconnect: () => changeDevices([]) };
}
it('waits for saved preferences and uses only the explicitly selected device', async () => {
  const f = fixture(); await expect(f.route.play(speech, new AbortController().signal)).rejects.toThrow(); expect(f.play).not.toHaveBeenCalled();
  await f.route.initialize(); await f.route.play(speech, new AbortController().signal);
  expect(f.play).toHaveBeenCalledWith(speech, expect.any(AbortSignal), 'speaker'); f.route.dispose();
});
it('does not route to default when the selected device disappears', async () => {
  const f = fixture(); await f.route.initialize(); await f.disconnect();
  f.play.mockRejectedValue(new Error('setSinkId failed'));
  await expect(f.route.play(speech, new AbortController().signal)).rejects.toThrow();
  expect(f.play).toHaveBeenCalledExactlyOnceWith(speech, expect.any(AbortSignal), 'speaker');
  expect(f.route.getSnapshot().error).toContain('не воспроизведён'); f.route.dispose();
});
it('uses the exact saved device when microphone-off permissions hide it from enumeration', async () => {
  const f = fixture(); await f.route.initialize(); await f.disconnect();
  await f.route.play(speech, new AbortController().signal);
  expect(f.play).toHaveBeenCalledExactlyOnceWith(speech, expect.any(AbortSignal), 'speaker'); f.route.dispose();
});
it('interrupts playback as a failure if the selected device disconnects', async () => {
  const f = fixture(); await f.route.initialize();
  f.play.mockImplementation((_speech, signal) => new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true })));
  const pending = f.route.play(speech, new AbortController().signal); const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(f.play).toHaveBeenCalledOnce()); await f.disconnect(); await rejected;
  expect(f.play).toHaveBeenCalledTimes(1); f.route.dispose();
});
it.each([
  ['microphone changes', ['speaker'], ['speaker']],
  ['another audio output connects', ['speaker'], ['speaker', 'headphones']],
  ['another audio output disconnects', ['speaker', 'headphones'], ['speaker']],
  ['permissions keep the selected output hidden', [], []],
])('keeps playback running when %s', async (_description, initialDevices, devices) => {
  const f = fixture(); await f.route.initialize();
  await f.changeDevices(initialDevices);
  let finish: () => void = () => undefined;
  f.play.mockImplementation((_speech, signal) => new Promise<void>(resolve => {
    finish = resolve;
    signal.addEventListener('abort', () => resolve(), { once: true });
  }));
  const pending = f.route.play(speech, new AbortController().signal);
  // Observe rejection immediately so the regression does not create an unhandled rejection.
  const outcome = pending.then(() => 'completed', () => 'failed');
  await vi.waitFor(() => expect(f.play).toHaveBeenCalledOnce());
  await f.changeDevices(devices);
  expect(f.play.mock.calls[0]?.[1].aborted).toBe(false);
  finish(); expect(await outcome).toBe('completed'); f.route.dispose();
});
it('rejects unsupported explicit output selection instead of using system default', async () => {
  const close = vi.fn(async () => undefined);
  vi.stubGlobal('AudioContext', class { close = close; });
  try { await expect(playSpeech(speech, new AbortController().signal, 'speaker')).rejects.toThrow('unavailable'); expect(close).toHaveBeenCalledOnce(); }
  finally { vi.unstubAllGlobals(); }
});
it('awaits setSinkId before starting Web Audio, and never starts on rejected selection', async () => {
  const calls: string[] = []; let sinkReady!: () => void;
  const sink = new Promise<void>(resolve => { sinkReady = resolve; });
  class Context {
    destination = {};
    async setSinkId(id: string) { calls.push(id); await sink; }
    createBuffer() { return { copyToChannel: () => undefined }; }
    createBufferSource() { const source = { buffer: null, connect: () => undefined, stop: () => undefined, onended: () => undefined, start: () => { calls.push('start'); source.onended(); } }; return source; }
    async resume() { calls.push('resume'); }
    async close() { calls.push('close'); }
  }
  vi.stubGlobal('AudioContext', Context);
  try {
    const pending = playSpeech(speech, new AbortController().signal, 'speaker');
    await Promise.resolve(); expect(calls).toEqual(['speaker']); sinkReady(); await pending;
    expect(calls).toEqual(['speaker', 'resume', 'start', 'close']);
    vi.spyOn(Context.prototype, 'setSinkId').mockRejectedValue(new Error('Denied'));
    calls.length = 0; await expect(playSpeech(speech, new AbortController().signal, 'missing')).rejects.toThrow();
    expect(calls).not.toContain('start');
  } finally { vi.unstubAllGlobals(); }
});
