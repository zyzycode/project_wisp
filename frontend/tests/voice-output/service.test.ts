import { afterEach, expect, it, vi } from 'vitest';
import { VoiceOutputService } from '../../src/application/services/voice-output-service';
import type { BrainStateDTO } from '../../src/shared/ipc-contracts';

const reply = { streamId: 'stream', conversationId: 'conversation', requestId: 'reply' };
function snapshot(): BrainStateDTO {
  return { streamId: 'stream', revision: 1, sampledAtMs: 0, cursorGame: null, autonomy: { quiet: false },
    character: { needs: { energy: 50, attention: 50, play: 50, comfort: 50, boredom: 50 }, synthesizedTone: 'neutral' }, activity: null,
    motion: { phase: 'grounded', rootScreenPosition: { x: 0, y: 0 }, velocityPxPerSec: { x: 0, y: 0 }, positionAuthority: 'voluntary' },
    visualIntent: { episodeId: 'episode', episodeSequence: 1, episodeStartedAtMs: 0, kind: 'idle_blink', category: 'idle', priority: 'low', interrupt: 'yes', loop: 'until_replaced', emotionalTone: 'neutral' }, dialogue: {
    conversationId: 'conversation', canSubmit: true,
    turn: { phase: 'completed', requestId: 'reply', replyText: 'Привет!', outcome: { kind: 'success' } },
  } };
}
function fixture() {
  let resolve: (value: { sampleRate: 24000; samples: Float32Array }) => void = () => undefined;
  let reject: () => void = () => undefined;
  const synthesizer = { ready: vi.fn(async () => true), dispose: vi.fn(async () => undefined), synthesize: vi.fn((_text: string, _language: 'ru' | 'en', signal: AbortSignal) => new Promise<{ sampleRate: 24000; samples: Float32Array }>((yes, no) => { resolve = yes; reject = () => no(new Error('Synthetic failure')); signal.addEventListener('abort', () => no(new Error('Cancelled')), { once: true }); })) };
  let sequence = 0;
  const options = { synthesizer, createId: () => `playback-${++sequence}`, language: () => 'ru' as const, blockInput: vi.fn(), revokeInput: vi.fn(), revokePlayback: vi.fn() };
  const service = new VoiceOutputService(options);
  return { service, options, fail: () => reject(), complete: () => resolve({ sampleRate: 24000, samples: new Float32Array(2400).fill(0.1) }) };
}
afterEach(() => vi.useRealTimers());
it('uses a bounded test tone lease and pauses STT until matching acknowledgement', async () => {
  const { service, options } = fixture();
  expect(service.hasSelectedPlaybackLease()).toBe(false);
  await service.selectDevice('selected-speaker');
  expect(service.hasSelectedPlaybackLease()).toBe(false);
  const result = service.testOutput(); expect(result.ok).toBe(true);
  expect(service.hasSelectedPlaybackLease()).toBe(true);
  expect(options.synthesizer.synthesize).not.toHaveBeenCalled(); expect(options.blockInput).toHaveBeenLastCalledWith(true);
  if (result.ok) { expect(result.value.samples.length).toBe(6000); service.acknowledge(result.value.playbackId); }
  expect(service.hasSelectedPlaybackLease()).toBe(false);
  expect(options.blockInput).toHaveBeenLastCalledWith(false); await service.dispose();
});
it('enables sound once at startup without overriding a subsequent explicit off', async () => {
  const { service } = fixture(); await service.initialize();
  expect(service.configureAtStartup()).toMatchObject({ ok: true, value: { enabled: true } });
  service.configure(false);
  expect(service.configureAtStartup()).toEqual({ ok: false, code: 'cancelled' });
  service.configure(true); service.reset();
  expect(service.configureAtStartup()).toEqual({ ok: false, code: 'cancelled' });
  await service.dispose();
});
it('never grants startup sound after lifecycle revocation before the first request', async () => {
  const { service } = fixture(); service.reset(); await service.initialize();
  expect(service.configureAtStartup()).toEqual({ ok: false, code: 'cancelled' }); await service.dispose();
});
it('reports synthesis failure without sending a playback cancellation that would suppress text fallback', async () => {
  const { service, options, fail } = fixture(); await service.initialize(); service.configure(true); service.observe(snapshot());
  const pending = service.speak(reply); fail();
  expect(await pending).toEqual({ ok: false, code: 'synthesis_failed' });
  expect(options.revokePlayback).not.toHaveBeenCalled();
  expect(options.revokeInput).toHaveBeenCalledOnce(); expect(options.blockInput).toHaveBeenLastCalledWith(false);
  await service.dispose();
});
it('uses canonical text, consumes identity once and releases STT only on matching playback ack', async () => {
  const { service, options, complete } = fixture(); await service.initialize(); service.configure(true); service.observe(snapshot());
  const pending = service.speak(reply);
  expect(options.synthesizer.synthesize).toHaveBeenCalledWith('Привет!', 'ru', expect.any(AbortSignal));
  expect(options.blockInput).toHaveBeenLastCalledWith(true);
  expect(await service.speak(reply)).toEqual({ ok: false, code: 'consumed' });
  complete(); const result = await pending; expect(result.ok).toBe(true);
  service.acknowledge('old'); expect(options.blockInput).toHaveBeenLastCalledWith(true);
  service.acknowledge('playback-1'); expect(options.blockInput).toHaveBeenLastCalledWith(false);
  expect(options.revokeInput).not.toHaveBeenCalled(); await service.dispose();
});
it('does not speak an old reply on enabling, nor accept stale/error/quiet identities', async () => {
  const { service, options } = fixture(); await service.initialize(); service.observe(snapshot()); service.configure(true);
  expect(await service.speak(reply)).toEqual({ ok: false, code: 'consumed' });
  expect(await service.speak({ ...reply, requestId: 'wrong' })).toEqual({ ok: false, code: 'stale' });
  service.observe({ ...snapshot(), autonomy: { quiet: true } });
  expect(await service.speak(reply)).toEqual({ ok: false, code: 'stale' });
  expect(options.synthesizer.synthesize).not.toHaveBeenCalled(); await service.dispose();
});
it('cancels pending inference on a new turn and rejects its late waveform', async () => {
  const { service, options, complete } = fixture(); await service.initialize(); service.configure(true); service.observe(snapshot());
  const pending = service.speak(reply);
  const next = snapshot(); service.observe({ ...next, dialogue: { ...next.dialogue, turn: { phase: 'thinking', requestId: 'next' }, canSubmit: false } });
  complete(); expect(await pending).toEqual({ ok: false, code: 'cancelled' });
  expect(options.revokeInput).toHaveBeenCalledOnce(); expect(options.revokePlayback).toHaveBeenCalledOnce(); await service.dispose();
});
it('bounds synthesis and playback ack deadlines; missing ack revokes microphone consent', async () => {
  vi.useFakeTimers();
  const { service, options, complete } = fixture(); await service.initialize(); service.configure(true); service.observe(snapshot());
  const pending = service.speak(reply); complete(); await pending;
  await vi.advanceTimersByTimeAsync(2100);
  expect(options.revokeInput).toHaveBeenCalledOnce();
  const next = snapshot(); service.observe({ ...next, dialogue: { ...next.dialogue, turn: { phase: 'completed', requestId: 'next', replyText: 'Ещё!', outcome: { kind: 'success' } } } });
  const timeout = service.speak({ ...reply, requestId: 'next' });
  await vi.advanceTimersByTimeAsync(120000); expect(await timeout).toEqual({ ok: false, code: 'timeout' });
  await service.dispose();
});
it('reset disables speech and revokes pending playback', async () => {
  const { service, options, complete } = fixture(); await service.initialize(); service.configure(true); service.observe(snapshot());
  const pending = service.speak(reply); complete(); await pending; service.reset();
  expect(await service.speak(reply)).toEqual({ ok: false, code: 'disabled' });
  expect(options.revokeInput).toHaveBeenCalledOnce(); await service.dispose();
});
