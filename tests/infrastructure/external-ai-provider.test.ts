import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { AIRequestControl } from '../../src/application/services/ai-request-control';
import { fixture, providerRequest, wire } from './backend-ai-fixture';

function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } }); }
function setup(fetcher: typeof fetch = vi.fn(async () => json(fixture('response.success.json')))) {
  const requestControl = new AIRequestControl();
  const provider = new ExternalAIProviderClient({ baseUrl: 'https://backend.example', development: false, now: Date.now, requestControl, fetch: fetcher });
  return { provider, requestControl, fetcher };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => vi.useRealTimers());
it('does no network work in getStatus and sends exactly one bounded JSON request without cookies/redirects', async () => {
  const fetcher = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => json(fixture('response.success.json')));
  const f = setup(fetcher);
  await expect(f.provider.getStatus()).resolves.toEqual({ kind: 'ready' }); expect(fetcher).not.toHaveBeenCalled();
  await expect(f.provider.generateResponse(providerRequest())).resolves.toMatchObject({ status: 'ok', reply: { text: 'Привет! Чем займёмся?', tone: 'warm' }, suggestedBehavior: 'respond', suggestedMood: 'happy', confidence: 0.9 });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0]![0])).toBe('https://backend.example/v1/chat');
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit' });
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual(wire);
});
it.each([{}, { decision: { behavior: 'play', confidence: 0.7, mood: 'playful', tone: 'playful' } }, { decision: { behavior: 'delete_files', confidence: 1 } }])('maps text only and wire-only playful mood without inventing curious: %j', patch => {
  const f = setup(vi.fn(async () => json({ version: 1, requestId: wire.requestId, text: 'ok', ...patch })));
  return expect(f.provider.generateResponse(providerRequest())).resolves.toMatchObject({ status: 'ok', reply: { text: 'ok' }, suggestedBehavior: patch.decision?.behavior === 'play' ? 'play' : 'respond' }).then(async () => {
    const second = await f.provider.generateResponse(providerRequest()); expect(second.suggestedMood).toBeUndefined();
  });
});
it.each(['http://remote.example', 'http://localhost', 'https://user:secret@host', 'file:///tmp/backend', 'https://host?secret=1'])('refuses unsafe deployment URL %s', baseUrl => {
  expect(() => new ExternalAIProviderClient({ baseUrl, development: false, now: Date.now, requestControl: new AIRequestControl() })).toThrow();
});
it('allows loopback HTTP only in development', () => {
  expect(() => new ExternalAIProviderClient({ baseUrl: 'http://127.0.0.1:8000', development: true, now: Date.now, requestControl: new AIRequestControl() })).not.toThrow();
});
it('rejects invalid snapshot without spending client budget or sending', async () => {
  const f = setup(); const request = providerRequest(); Object.assign(request.characterSnapshot.needs, { energy: NaN });
  await expect(f.provider.generateResponse(request)).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled();
  for (let i = 0; i < 6; i++) expect(f.requestControl.recordSubmission(0)).toBe(true);
});
it('keeps maximum valid multibyte context within the wire byte limit', async () => {
  const fetcher = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => json(fixture('response.success.json')));
  const f = setup(fetcher); const request = providerRequest();
  request.recentContext = Array.from({ length: 6 }, (_, index) => ({ role: index % 2 === 0 ? 'user' : 'wisp', text: '界'.repeat(index % 2 === 0 ? 240 : 2000), createdAt: '' }));
  Object.assign(request.characterSnapshot.personality, { aiSelfConcept: '界'.repeat(500) });
  await expect(f.provider.generateResponse(request)).resolves.toMatchObject({ status: 'ok' });
  expect(new TextEncoder().encode(String(fetcher.mock.calls[0]![1]!.body)).byteLength).toBeLessThanOrEqual(32 * 1024);
});
it.each([['rate_limited', 429, 'provider_unavailable', 60_000], ['budget_exhausted', 429, 'provider_unavailable', 60_000], ['upstream_unavailable', 503, 'provider_unavailable', 30_000], ['upstream_timeout', 504, 'timeout', 30_000], ['invalid_model_response', 502, 'unexpected_error', 30_000], ['invalid_request', 400, 'unexpected_error', 0]])('maps %s without retry and with local cooldown', async (code, status, reason, cooldown) => {
  const f = setup(vi.fn(async () => json({ version: 1, requestId: wire.requestId, error: { code } }, status)));
  await expect(f.provider.generateResponse(providerRequest())).resolves.toMatchObject({ status: 'fallback', diagnostics: { fallbackReason: reason } });
  expect(f.requestControl.availability(0).available).toBe(cooldown === 0);
  await vi.advanceTimersByTimeAsync(cooldown); expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect(f.requestControl.availability(Date.now()).available).toBe(true);
});
it.each([12_345, -1, 'bad', undefined])('uses retry hint or the local 60s default: %s', async retryAfterMs => {
  const f = setup(vi.fn(async () => json({ version: 1, requestId: wire.requestId, error: { code: 'rate_limited', retryAfterMs } }, 429)));
  await f.provider.generateResponse(providerRequest());
  const retry = typeof retryAfterMs === 'number' && retryAfterMs > 0 ? retryAfterMs : 60_000;
  expect(f.requestControl.availability(retry - 1).available).toBe(false); expect(f.requestControl.availability(retry).available).toBe(true);
});
it('maps network outage to local fallback without retries or leaking errors', async () => {
  const f = setup(vi.fn(async () => { throw new Error('secret token'); }));
  const result = await f.provider.generateResponse(providerRequest());
  expect(result.diagnostics?.fallbackReason).toBe('provider_unavailable'); expect(JSON.stringify(result)).not.toContain('secret');
  await vi.advanceTimersByTimeAsync(120_000); expect(f.fetcher).toHaveBeenCalledTimes(1);
});
it.each([() => new Response('<html>bad</html>', { status: 500 }), () => json({ version: 2, requestId: wire.requestId, text: 'bad' }), () => json({ version: 1, requestId: 'wrong', text: 'bad' }), () => json({ version: 1, requestId: wire.requestId, error: { code: 'rate_limited' } }, 503), () => new Response('{', { headers: { 'Content-Type': 'application/json' } })])('rejects malformed protocol instead of accepting any model hints', async response => {
  const f = setup(vi.fn(async () => response()));
  await expect(f.provider.generateResponse(providerRequest())).rejects.toThrow();
  expect(f.requestControl.availability(0).available).toBe(false); expect(f.fetcher).toHaveBeenCalledTimes(1);
});
it('cancels streamed body once its decoded byte limit is exceeded', async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(16 * 1024 + 1)); }, cancel });
  const f = setup(vi.fn(async () => new Response(stream, { headers: { 'Content-Type': 'application/json' } })));
  await expect(f.provider.generateResponse(providerRequest())).rejects.toThrow('large'); expect(cancel).toHaveBeenCalledOnce();
});
it.each([false, true])('aborts and settles after 12s even with stalled %s transport/body and no auto retry', async bodyStalled => {
  let signal: AbortSignal | undefined; let resolve!: (response: Response) => void;
  const pending = new Promise<Response>(yes => { resolve = yes; });
  const fetcher = vi.fn((_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    signal = init?.signal ?? undefined;
    return bodyStalled ? Promise.resolve(new Response(new ReadableStream(), { headers: { 'Content-Type': 'application/json' } })) : pending;
  });
  const f = setup(fetcher); const request = f.provider.generateResponse(providerRequest());
  await vi.advanceTimersByTimeAsync(12_000);
  await expect(request).resolves.toMatchObject({ diagnostics: { fallbackReason: 'timeout' } }); expect(signal?.aborted).toBe(true);
  resolve(json(fixture('response.success.json'))); await vi.advanceTimersByTimeAsync(60_000);
  expect(fetcher).toHaveBeenCalledTimes(1); await expect(f.provider.getStatus()).resolves.toEqual({ kind: 'ready' });
});
