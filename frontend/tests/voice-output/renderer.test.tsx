import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { VoiceOutputBridge, VoicePlaybackDTO } from '../../src/shared/voice-output-contracts';
import { VoiceReplyOutput } from '../../src/renderer/voice-reply-output';
import { ReplyOutputs, TextReplyOutput } from '../../src/renderer/reply-output';
import { VoiceOutputControls } from '../../src/renderer/components/Chat/VoiceOutputControls';
const reply = { streamId: 's', conversationId: 'c', requestId: 'r', text: 'Привет!', presentedAtMs: 10 };
const speech: VoicePlaybackDTO = { playbackId: 'p', sampleRate: 24000, samples: new Float32Array([0.1]) };
function fixture() {
  let resolve!: (value: Awaited<ReturnType<VoiceOutputBridge['speak']>>) => void;
  let revoke = () => undefined;
  const bridge: VoiceOutputBridge = {
    readStatus: async () => ({ ok: true, value: { enabled: false, ready: true, active: false } }),
    configure: async ({ enabled }) => ({ ok: true, value: { enabled, ready: true, active: false } }),
    speak: vi.fn(() => new Promise(done => { resolve = done; })),
    stop: vi.fn(async () => ({ ok: true, value: null })),
    acknowledge: vi.fn(async () => ({ ok: true, value: null })),
    onRevoked: listener => { revoke = listener; return () => undefined; },
  };
  const play = vi.fn(async (_speech: VoicePlaybackDTO, _signal: AbortSignal) => undefined);
  const voice = new VoiceReplyOutput(bridge, play);
  return { voice, bridge, play, resolve: (value: Awaited<ReturnType<VoiceOutputBridge['speak']>>) => resolve(value), revoke: () => revoke() };
}
it('shows the exact reply immediately through the same output interface while voice is pending', async () => {
  const f = fixture(); await f.voice.initialize(); await f.voice.configure(true);
  const display = vi.fn(); const output = new ReplyOutputs([new TextReplyOutput(display), f.voice]); output.submit(reply);
  expect(display).toHaveBeenCalledWith(expect.objectContaining({ text: reply.text, id: 'c:r', timestamp: 10 }));
  expect(f.bridge.speak).toHaveBeenCalledExactlyOnceWith({ streamId: 's', conversationId: 'c', requestId: 'r' });
  expect(f.voice.getSnapshot().phase).toBe('preparing');
  f.resolve({ ok: true, value: speech }); await vi.waitFor(() => expect(f.bridge.acknowledge).toHaveBeenCalledWith({ playbackId: 'p' }));
  expect(f.play).toHaveBeenCalledOnce(); expect(display).toHaveBeenCalledTimes(1); output.dispose();
});
it.each(['clear', 'revoke', 'dispose'] as const)('never plays a waveform resolving after %s', async reason => {
  const f = fixture(); await f.voice.initialize(); await f.voice.configure(true); f.voice.submit(reply);
  if (reason === 'revoke') f.revoke(); else f.voice[reason]();
  f.resolve({ ok: true, value: speech }); await vi.waitFor(() => expect(f.bridge.acknowledge).toHaveBeenCalledWith({ playbackId: 'p' }));
  expect(f.play).not.toHaveBeenCalled(); f.voice.dispose();
});
it('voice failure preserves the text and exposes recovery status', async () => {
  const f = fixture(); await f.voice.initialize(); await f.voice.configure(true);
  const display = vi.fn(); const output = new ReplyOutputs([new TextReplyOutput(display), f.voice]); output.submit(reply);
  f.resolve({ ok: false, code: 'synthesis_failed' }); await vi.waitFor(() => expect(f.voice.getSnapshot().error).toContain('Текст'));
  expect(display).toHaveBeenCalledTimes(1); expect(f.voice.getSnapshot().phase).toBe('idle'); output.dispose();
});
it('exposes accessible sound toggle and immediate stop during synthesis', () => {
  const markup = renderToStaticMarkup(<VoiceOutputControls client={{ configure: async () => undefined, clear: vi.fn() }} available state={{ enabled: true, ready: true, phase: 'preparing', error: null }} />);
  expect(markup).toContain('aria-pressed="true"'); expect(markup).toContain('Остановить речь'); expect(markup).toContain('микрофон на паузе');
});
