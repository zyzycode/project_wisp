import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { VoiceOutputBridge, VoicePlaybackDTO } from '../../src/shared/voice-output-contracts';
import { VoiceReplyOutput } from '../../src/renderer/voice-reply-output';
import { ReplyOutputRouter, TextReplyOutput } from '../../src/renderer/reply-output';
import type { IReplyOutput, ReplyOutputOutcome } from '../../src/renderer/reply-output';
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
it('uses voice instead of the bubble while speech is pending', async () => {
  const f = fixture(); await f.voice.initialize(); await f.voice.configure(true);
  const display = vi.fn(); const output = new ReplyOutputRouter({ text: new TextReplyOutput(display), voice: f.voice, voiceEnabled: () => f.voice.getSnapshot().enabled }); const pending = output.submit(reply);
  expect(display).toHaveBeenCalledExactlyOnceWith(null);
  expect(f.bridge.speak).toHaveBeenCalledExactlyOnceWith({ streamId: 's', conversationId: 'c', requestId: 'r' });
  expect(f.voice.getSnapshot().phase).toBe('preparing');
  f.resolve({ ok: true, value: speech }); await vi.waitFor(() => expect(f.bridge.acknowledge).toHaveBeenCalledWith({ playbackId: 'p' }));
  expect(await pending).toBe('presented'); expect(f.play).toHaveBeenCalledOnce(); expect(display).toHaveBeenCalledTimes(1); output.dispose();
});
it.each(['clear', 'revoke', 'dispose'] as const)('never plays a waveform resolving after %s', async reason => {
  const f = fixture(); await f.voice.initialize(); await f.voice.configure(true); f.voice.submit(reply);
  if (reason === 'revoke') f.revoke(); else f.voice[reason]();
  f.resolve({ ok: true, value: speech }); await vi.waitFor(() => expect(f.bridge.acknowledge).toHaveBeenCalledWith({ playbackId: 'p' }));
  expect(f.play).not.toHaveBeenCalled(); f.voice.dispose();
});
it('voice failure presents the exact reply through text fallback and exposes recovery status', async () => {
  const f = fixture(); await f.voice.initialize(); await f.voice.configure(true);
  const display = vi.fn(); const output = new ReplyOutputRouter({ text: new TextReplyOutput(display), voice: f.voice, voiceEnabled: () => f.voice.getSnapshot().enabled }); const pending = output.submit(reply);
  f.resolve({ ok: false, code: 'synthesis_failed' }); await vi.waitFor(() => expect(f.voice.getSnapshot().error).toContain('Текст'));
  await pending; expect(display).toHaveBeenCalledTimes(2);
  expect(display).toHaveBeenLastCalledWith(expect.objectContaining({ text: reply.text, id: 'c:r', timestamp: 10 }));
  expect(f.voice.getSnapshot().phase).toBe('idle'); output.dispose();
});
it('uses text alone when sound is off', async () => {
  const f = fixture(); await f.voice.initialize(); const display = vi.fn();
  const output = new ReplyOutputRouter({ text: new TextReplyOutput(display), voice: f.voice, voiceEnabled: () => false });
  expect(await output.submit(reply)).toBe('presented');
  expect(display).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: reply.text }));
  expect(f.bridge.speak).not.toHaveBeenCalled(); output.dispose();
});
it.each(['next', 'clear', 'dispose'] as const)('does not restore stale text after %s retires a failed voice reply', async reason => {
  const display = vi.fn(); let fail!: (outcome: ReplyOutputOutcome) => void;
  const voice: IReplyOutput = { submit: () => new Promise(resolve => { fail = resolve; }), clear: vi.fn(), dispose: vi.fn() };
  let enabled = true;
  const output = new ReplyOutputRouter({ text: new TextReplyOutput(display), voice, voiceEnabled: () => enabled });
  const pending = output.submit(reply);
  if (reason === 'next') { enabled = false; await output.submit({ ...reply, requestId: 'next', text: 'Новая реплика' }); }
  else output[reason]();
  const calls = display.mock.calls.length; fail('failed'); expect(await pending).toBe('cancelled');
  expect(display).toHaveBeenCalledTimes(calls); output.dispose();
});
it.each(['cancelled', 'stale', 'consumed', 'disabled'] as const)('does not turn %s into text fallback', async code => {
  const f = fixture(); await f.voice.initialize(); await f.voice.configure(true); const display = vi.fn();
  const output = new ReplyOutputRouter({ text: new TextReplyOutput(display), voice: f.voice, voiceEnabled: () => true });
  const pending = output.submit(reply); f.resolve({ ok: false, code });
  expect(await pending).toBe('cancelled'); expect(display).toHaveBeenCalledExactlyOnceWith(null); output.dispose();
});
it('falls back to text when the browser cannot play the synthesized PCM', async () => {
  const f = fixture(); f.play.mockRejectedValue(new Error('Audio device unavailable'));
  await f.voice.initialize(); await f.voice.configure(true); const display = vi.fn();
  const output = new ReplyOutputRouter({ text: new TextReplyOutput(display), voice: f.voice, voiceEnabled: () => true });
  const pending = output.submit(reply); f.resolve({ ok: true, value: speech });
  await pending; expect(display).toHaveBeenLastCalledWith(expect.objectContaining({ text: reply.text }));
  expect(f.bridge.acknowledge).toHaveBeenCalledWith({ playbackId: 'p' }); output.dispose();
});
it('exposes accessible sound toggle and immediate stop during synthesis', () => {
  const markup = renderToStaticMarkup(<VoiceOutputControls client={{ configure: async () => undefined, clear: vi.fn() }} available state={{ enabled: true, ready: true, phase: 'preparing', error: null }} />);
  expect(markup).toContain('aria-pressed="true"'); expect(markup).toContain('Остановить речь'); expect(markup).toContain('микрофон на паузе');
});
