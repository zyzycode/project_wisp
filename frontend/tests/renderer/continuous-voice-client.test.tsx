import { afterEach, expect, it, vi } from 'vitest';
import { ContinuousVoiceClient } from '../../src/renderer/continuous-voice-client';
import type { StartContinuousVoiceCapture } from '../../src/renderer/continuous-voice-capture';
import type { VoiceInputApiBridge } from '../../src/shared/ipc-contracts';
const context = { streamId: 's', conversationId: 'c' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(start?: StartContinuousVoiceCapture) {
  let samples: (input: Float32Array) => void = () => undefined;
  let failed: () => void = () => undefined;
  let disabled: () => void = () => undefined;
  const cancel = vi.fn();
  const bridge = {
    enableAtStartup: vi.fn<VoiceInputApiBridge['enableAtStartup']>().mockResolvedValue({ ok: true, value: null }),
    readStatus: vi.fn<VoiceInputApiBridge['readStatus']>().mockResolvedValue({ ok: true, value: { state: 'ready', downloadedBytes: 1, totalBytes: 1 } }),
    prepare: vi.fn<VoiceInputApiBridge['prepare']>(),
    enable: vi.fn<VoiceInputApiBridge['enable']>().mockResolvedValue({ ok: true, value: null }),
    disable: vi.fn<VoiceInputApiBridge['disable']>().mockResolvedValue({ ok: true, value: null }),
    begin: vi.fn<VoiceInputApiBridge['begin']>().mockResolvedValue({ ok: true, value: { requestId: 'r' } }),
    transcribe: vi.fn<VoiceInputApiBridge['transcribe']>().mockResolvedValue({ ok: true, value: { text: 'Привет' } }),
    cancel: vi.fn<VoiceInputApiBridge['cancel']>().mockResolvedValue({ ok: true, value: null }),
    onDisabled: vi.fn((listener: () => void) => { disabled = listener; return vi.fn(); }),
  };
  const submit = vi.fn(async (_text: string) => true);
  const client = new ContinuousVoiceClient(bridge, submit, start ?? (async (_signal, onSamples, onError) => { samples = onSamples; failed = onError; return { cancel }; }));
  client.setContext(context); client.setCanSubmit(true);
  const feed = (count: number, amplitude: number) => { for (let i = 0; i < count; i++) samples(new Float32Array(320).fill(amplitude)); };
  const phrase = () => { feed(20, 0.1); feed(40, 0); };
  return { client, bridge, submit, cancel, feed, phrase, fail: () => failed(), remoteDisable: () => disabled() };
}
afterEach(() => vi.restoreAllMocks());
it('uses the one-shot Main startup grant instead of explicit enable', async () => {
  const f = fixture(); await f.client.enableAtStartup();
  expect(f.bridge.enableAtStartup).toHaveBeenCalledOnce(); expect(f.bridge.enable).not.toHaveBeenCalled();
  expect(f.client.getSnapshot().enabled).toBe(true); f.client.disable();
});
it('drops speech output feedback, invalidates a pending transcript and resumes only with retained consent', async () => {
  const f = fixture(); const result = deferred<Awaited<ReturnType<VoiceInputApiBridge['transcribe']>>>();
  f.bridge.transcribe.mockReturnValue(result.promise); await f.client.enable('ru'); f.phrase();
  await vi.waitFor(() => expect(f.bridge.transcribe).toHaveBeenCalledOnce());
  f.client.setOutputBlocked(true); expect(f.client.getSnapshot().phase).toBe('paused');
  result.resolve({ ok: true, value: { text: 'Echo' } }); await Promise.resolve(); await Promise.resolve();
  f.phrase(); expect(f.submit).not.toHaveBeenCalled();
  f.client.setOutputBlocked(false); expect(f.client.getSnapshot().phase).toBe('listening');
  f.remoteDisable(); f.client.setOutputBlocked(true); f.client.setOutputBlocked(false);
  expect(f.client.getSnapshot().phase).toBe('off');
});
it('starts only explicitly and automatically submits successive utterances without restarting the microphone', async () => {
  const f = fixture(); expect(f.bridge.enable).not.toHaveBeenCalled();
  await f.client.enable('ru'); expect(f.client.getSnapshot().phase).toBe('listening');
  f.phrase(); f.phrase(); await vi.waitFor(() => expect(f.submit).toHaveBeenCalledExactlyOnceWith('Привет'));
  expect(f.bridge.transcribe).toHaveBeenCalledOnce(); expect(f.cancel).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(f.client.getSnapshot().phase).toBe('listening'));
  f.phrase(); await vi.waitFor(() => expect(f.submit).toHaveBeenCalledTimes(2)); f.client.disable();
  expect(f.cancel).toHaveBeenCalledOnce(); expect(f.bridge.disable).toHaveBeenCalledOnce();
});
it('drops all audio while dialogue is busy and never queues it for later', async () => {
  const f = fixture(); await f.client.enable('ru');
  f.client.setCanSubmit(false); f.phrase(); expect(f.client.getSnapshot().phase).toBe('paused');
  f.client.setCanSubmit(true); f.feed(45, 0); await Promise.resolve(); expect(f.bridge.begin).not.toHaveBeenCalled();
  f.phrase(); await vi.waitFor(() => expect(f.submit).toHaveBeenCalledOnce()); f.client.disable();
});
it.each(['off', 'context', 'busy', 'remote'])('rejects late recognition after %s and clears the capture lease', async reason => {
  const f = fixture(); const result = deferred<Awaited<ReturnType<VoiceInputApiBridge['transcribe']>>>();
  f.bridge.transcribe.mockReturnValue(result.promise); await f.client.enable('ru'); f.phrase();
  await vi.waitFor(() => expect(f.bridge.transcribe).toHaveBeenCalledOnce());
  if (reason === 'off') f.client.disable();
  if (reason === 'context') f.client.setContext({ ...context, conversationId: 'new' });
  if (reason === 'busy') f.client.setCanSubmit(false);
  if (reason === 'remote') f.remoteDisable();
  result.resolve({ ok: true, value: { text: 'Late' } }); await Promise.resolve(); await Promise.resolve();
  expect(f.submit).not.toHaveBeenCalled(); expect(f.bridge.cancel).toHaveBeenCalledWith({ requestId: 'r' });
  f.client.disable();
});
it('cancels microphone permission resolving after mode off', async () => {
  const capture = deferred<{ cancel(): void }>(); let signal: AbortSignal | undefined;
  const f = fixture(async incoming => { signal = incoming; return capture.promise; });
  const pending = f.client.enable('ru'); await vi.waitFor(() => expect(signal).toBeDefined());
  f.client.disable(); expect(signal?.aborted).toBe(true); capture.resolve({ cancel: f.cancel }); await pending;
  expect(f.cancel).toHaveBeenCalledOnce(); expect(f.client.getSnapshot().phase).toBe('off');
});
it.each(['', 'x'.repeat(241)])('does not auto-send empty or overlong text', async text => {
  const f = fixture(); f.bridge.transcribe.mockResolvedValue({ ok: true, value: { text } });
  await f.client.enable('ru'); f.phrase(); await vi.waitFor(() => expect(f.client.getSnapshot().phase).toBe('listening'));
  expect(f.submit).not.toHaveBeenCalled(); if (text) expect(f.client.getSnapshot().error).toContain('240'); f.client.disable();
});
it('stops microphone mode on device loss with a safe error', async () => {
  const f = fixture(); await f.client.enable('ru'); f.fail();
  expect(f.client.getSnapshot().enabled).toBe(false); expect(f.cancel).toHaveBeenCalledOnce();
  expect(f.client.getSnapshot().error).toBeTruthy();
});
it('never downloads a missing model at runtime', async () => {
  const f = fixture(); f.bridge.readStatus.mockResolvedValue({ ok: true, value: { state: 'not_installed', downloadedBytes: 0, totalBytes: 1 } });
  await f.client.enable('ru'); expect(f.bridge.prepare).not.toHaveBeenCalled(); expect(f.bridge.enable).not.toHaveBeenCalled();
  expect(f.client.getSnapshot().enabled).toBe(false); expect(f.client.getSnapshot().error).toBeTruthy();
});
it('revokes a mode enable acknowledgement arriving after explicit off', async () => {
  const f = fixture(); const enabled = deferred<Awaited<ReturnType<VoiceInputApiBridge['enable']>>>();
  f.bridge.enable.mockReturnValue(enabled.promise);
  const pending = f.client.enable('ru'); await vi.waitFor(() => expect(f.bridge.enable).toHaveBeenCalledOnce());
  f.client.disable(); expect(f.bridge.disable).toHaveBeenCalledOnce();
  enabled.resolve({ ok: true, value: null }); await pending;
  expect(f.bridge.disable).toHaveBeenCalledTimes(2);
  expect(f.client.getSnapshot().phase).toBe('off'); expect(f.cancel).not.toHaveBeenCalled();
});
it('does not open microphone when Main revokes mode during enable', async () => {
  const start = vi.fn<StartContinuousVoiceCapture>(async () => ({ cancel: vi.fn() }));
  const f = fixture(start); const enabled = deferred<Awaited<ReturnType<VoiceInputApiBridge['enable']>>>();
  f.bridge.enable.mockReturnValue(enabled.promise);
  const pending = f.client.enable('ru'); await vi.waitFor(() => expect(f.bridge.enable).toHaveBeenCalledOnce());
  f.remoteDisable(); expect(f.bridge.disable).not.toHaveBeenCalled();
  enabled.resolve({ ok: true, value: null }); await pending;
  expect(start).not.toHaveBeenCalled(); expect(f.bridge.disable).toHaveBeenCalledOnce();
  expect(f.client.getSnapshot().enabled).toBe(false);
});
it('drops a late begin lease when dialogue becomes busy before the reply', async () => {
  const f = fixture(); const lease = deferred<Awaited<ReturnType<VoiceInputApiBridge['begin']>>>();
  f.bridge.begin.mockReturnValue(lease.promise); await f.client.enable('ru'); f.phrase();
  expect(f.bridge.begin).toHaveBeenCalledOnce(); f.client.setCanSubmit(false);
  lease.resolve({ ok: true, value: { requestId: 'late' } });
  await vi.waitFor(() => expect(f.bridge.cancel).toHaveBeenCalledWith({ requestId: 'late' }));
  expect(f.bridge.transcribe).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled(); f.client.disable();
});
it('preserves a pending send during admission changes, then resumes only when ready', async () => {
  const f = fixture(); const sent = deferred<boolean>(); f.submit.mockReturnValue(sent.promise);
  await f.client.enable('ru'); f.phrase(); await vi.waitFor(() => expect(f.submit).toHaveBeenCalledOnce());
  f.client.setCanSubmit(false); expect(f.client.getSnapshot().phase).toBe('sending'); f.phrase();
  sent.resolve(true); await vi.waitFor(() => expect(f.client.getSnapshot().phase).toBe('paused'));
  expect(f.submit).toHaveBeenCalledOnce(); expect(f.client.getSnapshot().error).toBeNull();
  f.client.setCanSubmit(true); expect(f.client.getSnapshot().phase).toBe('listening'); f.client.disable();
});
it('ignores callbacks from an old capture after switching the microphone back on', async () => {
  const captures: { samples: (input: Float32Array) => void; error: () => void }[] = [];
  const f = fixture(async (_signal, samples, error) => { captures.push({ samples, error }); return { cancel: vi.fn() }; });
  await f.client.enable('ru'); f.client.disable(); await f.client.enable('ru');
  captures[0]?.error();
  for (let i = 0; i < 20; i++) captures[0]?.samples(new Float32Array(320).fill(0.1));
  for (let i = 0; i < 40; i++) captures[0]?.samples(new Float32Array(320));
  expect(f.client.getSnapshot().enabled).toBe(true); expect(f.bridge.begin).not.toHaveBeenCalled(); f.client.disable();
});
it('releases the mode even if browser capture teardown throws', async () => {
  const f = fixture(async () => ({ cancel: () => { throw new Error('browser teardown'); } }));
  await f.client.enable('ru'); expect(() => f.client.disable()).not.toThrow();
  expect(f.client.getSnapshot().enabled).toBe(false); expect(f.bridge.disable).toHaveBeenCalledOnce();
});
