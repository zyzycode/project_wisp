import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceInputService } from '../../src/application/services/voice-input-service';
import type { IVoiceInput, VoiceInputResult } from '../../src/application/ports/voice-input.port';
const context = { streamId: 'stream', conversationId: 'conversation' };
function fixture() {
  vi.useFakeTimers();
  const adapter: IVoiceInput = { getStatus: () => ({ state: 'ready', downloadedBytes: 1, totalBytes: 1 }), prepare: vi.fn(async () => ({ ok: true as const, value: undefined })), transcribe: vi.fn(async () => ({ ok: true as const, value: 'Hello' })), dispose: vi.fn(async () => undefined) };
  const service = new VoiceInputService({ adapter, context: () => context, createId: () => 'request', schedule: (callback, delay) => { const t = setTimeout(callback, delay); return () => clearTimeout(t); } });
  const command = { ...context, requestId: 'request', language: 'en' as const, samples: [0.1] };
  return { service, adapter, command };
}
afterEach(() => vi.useRealTimers());
describe('voice lifecycle', () => {
  it('starts off in every process, including after a previous enabled session', () => {
    const previous = fixture().service;
    previous.enable(context);
    expect(previous.hasCaptureLease()).toBe(true);
    const current = fixture().service;
    expect(current.hasCaptureLease()).toBe(false);
    expect(current.begin(context)).toEqual({ ok: false, code: 'cancelled' });
    previous.disable();
    expect(fixture().service.hasCaptureLease()).toBe(false);
  });
  it('blocks capture and invalidates pending transcription throughout speech output', async () => {
    const { service, adapter, command } = fixture(); service.enable(context); service.begin(context);
    let finish!: (value: VoiceInputResult<string>) => void;
    vi.mocked(adapter.transcribe).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = service.transcribe(command); service.setOutputBlocked(true);
    expect(service.begin(context)).toEqual({ ok: false, code: 'busy' });
    expect(await service.transcribe(command)).toEqual({ ok: false, code: 'busy' });
    finish({ ok: true, value: 'Own voice' }); expect(await pending).toEqual({ ok: false, code: 'cancelled' });
    service.setOutputBlocked(false); expect(service.begin(context).ok).toBe(true);
    service.setOutputBlocked(true); service.disable(); service.setOutputBlocked(false);
    expect(service.begin(context)).toEqual({ ok: false, code: 'cancelled' });
  });
  it('bounds capture lease and rejects stale requests', () => {
    const { service } = fixture(); service.enable(context);
    expect(service.begin({ ...context, conversationId: 'stale' })).toEqual({ ok: false, code: 'stale_context' });
    expect(service.begin(context).ok).toBe(true); expect(service.hasCaptureLease()).toBe(true);
    expect(service.begin(context)).toEqual({ ok: false, code: 'busy' });
    vi.advanceTimersByTime(45000); expect(service.hasCaptureLease()).toBe(true);
    expect(service.begin(context).ok).toBe(true); service.disable(); expect(service.hasCaptureLease()).toBe(false);
  });
  it('consumes lease once and rejects late result after cancellation', async () => {
    const { service, adapter, command } = fixture(); service.enable(context);
    let finish!: (value: VoiceInputResult<string>) => void;
    vi.mocked(adapter.transcribe).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    service.begin(context); const pending = service.transcribe(command);
    expect(service.hasCaptureLease()).toBe(true);
    expect(await service.transcribe(command)).toEqual({ ok: false, code: 'busy' });
    service.cancel('request'); finish({ ok: true, value: 'Late' });
    expect(await pending).toEqual({ ok: false, code: 'cancelled' });
  });
  it.each([['', 'empty_transcript'], ['x'.repeat(241), 'text_too_long']])('preserves explicit transcript failure %s', async (text, code) => {
    const { service, adapter, command } = fixture(); service.enable(context);
    vi.mocked(adapter.transcribe).mockResolvedValue({ ok: true, value: text }); service.begin(context);
    expect(await service.transcribe(command)).toEqual({ ok: false, code });
  });
  it('aborts inference at deadline and reports timeout', async () => {
    const { service, adapter, command } = fixture(); service.enable(context);
    vi.mocked(adapter.transcribe).mockImplementation((_audio, signal) => new Promise(resolve => { signal.addEventListener('abort', () => resolve({ ok: false, code: 'cancelled' })); }));
    service.begin(context); const pending = service.transcribe(command); await vi.advanceTimersByTimeAsync(60000);
    expect(await pending).toEqual({ ok: false, code: 'timeout' });
  });
});


describe('continuous voice permission', () => {
  it('requires explicit enable and keeps mode beyond one utterance deadline', () => {
    const { service } = fixture();
    expect(service.hasCaptureLease()).toBe(false);
    expect(service.enable(context)).toEqual({ ok: true, value: null });
    expect(service.hasCaptureLease()).toBe(true);
    service.begin(context);
    vi.advanceTimersByTime(45000);
    expect(service.hasCaptureLease()).toBe(true);
    expect(service.begin(context).ok).toBe(true);
    service.disable();
    expect(service.hasCaptureLease()).toBe(false);
    expect(service.begin(context)).toEqual({ ok: false, code: 'cancelled' });
  });
  it('preserves continuous permission after a completed utterance', async () => {
    const { service, command } = fixture();
    service.enable(context); service.begin(context);
    expect(await service.transcribe(command)).toEqual({ ok: true, value: { text: 'Hello' } });
    expect(service.hasCaptureLease()).toBe(true);
    service.disable();
  });
  it('notifies revocation even when off and rejects pending transcription after disable', async () => {
    const notify = vi.fn();
    let finish!: (result: VoiceInputResult<string>) => void;
    const f = fixture();
    const service = new VoiceInputService({ adapter: f.adapter, context: () => context,
      createId: () => 'request', schedule: () => () => undefined, onDisabled: notify });
    vi.mocked(f.adapter.transcribe).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    service.enable(context); service.begin(context);
    const pending = service.transcribe(f.command);
    service.disable(); service.disable(); finish({ ok: true, value: 'Late' });
    expect(await pending).toEqual({ ok: false, code: 'cancelled' });
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
