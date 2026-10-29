import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceInputClient } from '../../src/renderer/voice-input-client';
import type { VoiceCapture, StartVoiceCapture } from '../../src/renderer/voice-pcm-capture';
import type { VoiceInputApiBridge, VoiceInputResultDTO } from '../../src/shared/ipc-contracts';

const context = { streamId: 'stream', conversationId: 'conversation' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(start?: StartVoiceCapture) {
  const result = deferred<VoiceInputResultDTO<{ text: string }>>();
  const capture = { stop: vi.fn(() => [0, 0.2, -0.2]), cancel: vi.fn() };
  const bridge = {
    readStatus: vi.fn<VoiceInputApiBridge['readStatus']>().mockResolvedValue({ ok: true, value: { state: 'ready', downloadedBytes: 10, totalBytes: 10 } }),
    prepare: vi.fn<VoiceInputApiBridge['prepare']>().mockResolvedValue({ ok: true, value: { state: 'ready', downloadedBytes: 10, totalBytes: 10 } }),
    begin: vi.fn<VoiceInputApiBridge['begin']>().mockResolvedValue({ ok: true, value: { requestId: 'request' } }),
    transcribe: vi.fn<VoiceInputApiBridge['transcribe']>().mockReturnValue(result.promise),
    cancel: vi.fn<VoiceInputApiBridge['cancel']>().mockResolvedValue({ ok: true, value: null }),
  };
  const draft = vi.fn();
  const client = new VoiceInputClient(bridge, draft, start ?? (async () => capture));
  client.activate(context);
  return { client, bridge, draft, capture, result };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('voice draft lifecycle', () => {
  it('records and stops into an editable draft, with language and no message submission capability', async () => {
    const f = fixture();
    await f.client.start('en');
    expect(f.client.getSnapshot().phase).toBe('recording');
    const pending = f.client.stop();
    expect(f.capture.stop).toHaveBeenCalledOnce();
    expect(f.client.getSnapshot().phase).toBe('transcribing');
    expect(f.bridge.transcribe).toHaveBeenCalledWith({ ...context, requestId: 'request', language: 'en', samples: [0, 0.2, -0.2] });
    f.result.resolve({ ok: true, value: { text: ' Hello ' } }); await pending;
    expect(f.draft).toHaveBeenCalledExactlyOnceWith('Hello');
    expect(f.client.getSnapshot().phase).toBe('idle');
    f.client.deactivate();
  });
  it.each(['manual edit', 'cancel', 'close', 'new stream', 'new conversation'])('preserves the draft after %s while transcription is pending', async reason => {
    const f = fixture(); await f.client.start('ru'); const pending = f.client.stop();
    if (reason === 'close') f.client.deactivate();
    else if (reason === 'new stream') f.client.activate({ ...context, streamId: 'next' });
    else if (reason === 'new conversation') f.client.activate({ ...context, conversationId: 'next' });
    else f.client.cancel();
    f.result.resolve({ ok: true, value: { text: 'stale transcript' } }); await pending;
    expect(f.draft).not.toHaveBeenCalled(); expect(f.bridge.cancel).toHaveBeenCalledWith({ requestId: 'request' });
    f.client.deactivate();
  });
  it('aborts a late microphone permission and disposes its eventual capture', async () => {
    const permission = deferred<VoiceCapture>(); let signal: AbortSignal | undefined;
    const f = fixture(async incoming => { signal = incoming; return permission.promise; });
    const pending = f.client.start('ru'); await Promise.resolve();
    f.client.deactivate(); expect(signal?.aborted).toBe(true);
    permission.resolve(f.capture); await pending;
    expect(f.capture.cancel).toHaveBeenCalledOnce(); expect(f.draft).not.toHaveBeenCalled();
  });
  it('revokes a late begin lease after closing', async () => {
    const f = fixture(); const lease = deferred<VoiceInputResultDTO<{ requestId: string }>>();
    f.bridge.begin.mockReturnValue(lease.promise);
    const pending = f.client.start('ru'); f.client.deactivate();
    lease.resolve({ ok: true, value: { requestId: 'late' } }); await pending;
    expect(f.bridge.cancel).toHaveBeenCalledWith({ requestId: 'late' });
    expect(f.client.getSnapshot().phase).toBe('idle');
  });
  it.each(['', '  ', 'x'.repeat(241)])('rejects empty or overlong transcript without replacing draft', async text => {
    const f = fixture(); await f.client.start('ru'); const pending = f.client.stop();
    f.result.resolve({ ok: true, value: { text } }); await pending;
    expect(f.draft).not.toHaveBeenCalled(); expect(f.client.getSnapshot().error).toBeTruthy(); f.client.deactivate();
  });
  it.each(['NotAllowedError', 'NotFoundError'])('keeps text entry available on %s', async name => {
    const f = fixture(async () => { throw new DOMException('private details', name); });
    await f.client.start('ru'); expect(f.client.getSnapshot().phase).toBe('idle');
    expect(f.client.getSnapshot().error).toBeTruthy(); expect(f.client.getSnapshot().error).not.toContain('private');
    expect(f.bridge.cancel).toHaveBeenCalledOnce(); expect(f.draft).not.toHaveBeenCalled(); f.client.deactivate();
  });
  it('automatically transcribes at capture limit and prevents duplicate stop/start', async () => {
    let limit = () => {};
    const capture = { stop: vi.fn(() => [0.3]), cancel: vi.fn() };
    const f = fixture(async (_signal, onLimit) => { limit = onLimit; return capture; });
    await f.client.start('ru'); await f.client.start('en'); limit(); limit();
    expect(f.bridge.begin).toHaveBeenCalledOnce(); expect(f.bridge.transcribe).toHaveBeenCalledOnce();
    f.client.deactivate();
  });
  it('cleans the capture lease when the browser stop operation fails', async () => {
    const f = fixture(); await f.client.start('ru');
    f.capture.stop.mockImplementation(() => { throw new Error('browser teardown'); });
    await f.client.stop();
    expect(f.client.getSnapshot().phase).toBe('idle');
    expect(f.client.getSnapshot().error).toBeTruthy();
    expect(f.bridge.cancel).toHaveBeenCalledOnce();
    expect(f.draft).not.toHaveBeenCalled(); f.client.deactivate();
  });
  it('allows explicit retry after model status transport failure', async () => {
    const f = fixture(); f.client.deactivate();
    f.bridge.readStatus.mockRejectedValue(new Error('internal path'));
    f.client.activate(context); await Promise.resolve();
    expect(f.client.getSnapshot().model?.state).toBe('error');
    expect(f.client.getSnapshot().error).not.toContain('internal path');
    expect(vi.getTimerCount()).toBe(0); f.client.deactivate();
  });
  it('prepares only on request and polls model progress without recording', async () => {
    const f = fixture(); const download = deferred<Awaited<ReturnType<VoiceInputApiBridge['prepare']>>>();
    f.bridge.prepare.mockReturnValue(download.promise);
    await Promise.resolve(); expect(f.bridge.prepare).not.toHaveBeenCalled();
    const pending = f.client.prepare();
    f.bridge.readStatus.mockResolvedValue({ ok: true, value: { state: 'downloading', downloadedBytes: 5, totalBytes: 10 } });
    await vi.advanceTimersByTimeAsync(700);
    expect(f.client.getSnapshot().model?.downloadedBytes).toBe(5);
    f.client.deactivate(); download.resolve({ ok: true, value: { state: 'ready', downloadedBytes: 10, totalBytes: 10 } }); await pending;
    expect(f.bridge.begin).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
