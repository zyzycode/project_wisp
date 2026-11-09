import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { parseBackendScreenRequest, parseBackendScreenResponse, parseScreenCapability } from '../../src/infrastructure/ai/backend-screen-observation-validation';
import { providerRequest } from './backend-ai-fixture';
import type { PreparedScreenObservation } from '../../src/application/ports/screen-observation.interface';
const corpus = JSON.parse(readFileSync(new URL('../../../docs/contracts/fixtures/desktop-backend-v1/screen-observation.json', import.meta.url), 'utf8'));
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
const capability = { status: 'available', provider: 'openai', model: 'gpt-6-astra', policyRevision: 'screen-openai-2026-11' };
const request = parseBackendScreenRequest(corpus.requests.valid[0].value);
function prepared(): PreparedScreenObservation { return { context: { streamId: 's', conversationId: 'c', requestId: request.requestId, generation: 0 }, image: request.image, previewId: 'p', digest: createHash('sha256').update(Buffer.from(request.image.dataBase64, 'base64')).digest('hex'), preparedAtMs: Date.now(), expiresAtMs: Date.now() + 30000 }; }
function setup(fetcher = vi.fn<typeof fetch>(async () => json(capability))) {
  const provider = new ExternalAIProviderClient({ baseUrl: 'http://127.0.0.1:12345', sessionToken: 'a'.repeat(64), development: true, fetch: fetcher, now: Date.now });
  return { provider, screen: provider.screenObservation, fetcher };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100); }); afterEach(() => vi.useRealTimers());
it('shares strict request/evidence fixtures with Python', () => {
  for (const c of corpus.requests.valid) expect(() => parseBackendScreenRequest(c.value), c.name).not.toThrow();
  for (const c of corpus.requests.invalid) expect(() => parseBackendScreenRequest(c.value), c.name).toThrow();
  for (const c of corpus.responses.valid) expect(() => parseBackendScreenResponse(c.value, c.value.requestId), c.name).not.toThrow();
  for (const c of corpus.responses.invalid) expect(() => parseBackendScreenResponse(c.value, request.requestId), c.name).toThrow();
  expect(() => parseScreenCapability({ ...capability, model: 'gpt-6-sol' })).toThrow();
});
it('reserves common transport before capture; capability is authenticated GET without image/inference', async () => {
  const f = setup(); expect(f.screen.reserve(request.requestId)).toBe(true); expect(f.provider.canStartObservation()).toBe(false);
  await expect(f.provider.generateResponse(providerRequest())).rejects.toThrow();
  expect(await f.screen.getCapability(new AbortController().signal)).toEqual(capability);
  expect(f.fetcher).toHaveBeenCalledOnce(); expect(f.fetcher.mock.calls[0]).toMatchObject(['http://127.0.0.1:12345/v1/screen-observation/capability', { method: 'GET', headers: { Authorization: `Bearer ${'a'.repeat(64)}` }, redirect: 'error', credentials: 'omit', cache: 'no-store' }]);
  f.screen.release(request.requestId); expect(f.provider.canStartObservation()).toBe(true);
});
it('binds request to immutable crop/digest and independently rejects forged/oversized/model output', async () => {
  const f = setup(vi.fn(async () => json({ requestId: request.requestId, observation: { visible: ['shape'], possible: [], unknown: [] } })));
  f.screen.reserve(request.requestId); const p = prepared(), auth = { context: p.context, previewId: p.previewId, digest: p.digest, confirmationId: 'confirm', policyRevision: 'screen-openai-2026-11' as const, authorizedAtMs: Date.now(), expiresAtMs: Date.now() + 8000 };
  await expect(f.screen.observe(p, { ...auth, digest: 'forged' }, 'en', new AbortController().signal)).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled();
  expect(await f.screen.observe(p, auth, 'en', new AbortController().signal)).toEqual({ visible: ['shape'], possible: [], unknown: [] });
  const body = JSON.parse(String(f.fetcher.mock.calls[0]![1]!.body)); expect(body).toEqual({ ...request, locale: 'en' });
});
it.each([401, 403, 409, 502, 503, 504])('omits evidence on HTTP%s without retry', async status => {
  const f = setup(vi.fn(async () => json({ private: 'not propagated' }, status))); f.screen.reserve(request.requestId);
  await expect(f.screen.getCapability(new AbortController().signal)).rejects.toThrow('unavailable'); expect(f.fetcher).toHaveBeenCalledOnce();
});
it('bounds capability response/deadline and retains retired singleflight until ignored fetch settles', async () => {
  let resolve!: (value: Response) => void;
  const f = setup(vi.fn(() => new Promise<Response>(yes => { resolve = yes; }))); f.screen.reserve(request.requestId);
  const result = f.screen.getCapability(new AbortController().signal); const failed = expect(result).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(1000); await failed; f.screen.release(request.requestId); expect(f.provider.canStartObservation()).toBe(false);
  resolve(json(capability)); await vi.advanceTimersByTimeAsync(0); expect(f.provider.canStartObservation()).toBe(true);
  const large = setup(vi.fn(async () => json({ padding: 'x'.repeat(1025) }))); large.screen.reserve(request.requestId);
  await expect(large.screen.getCapability(new AbortController().signal)).rejects.toThrow('large');
});
it('never grants screen route to remote/standalone profile', () => {
  const provider = new ExternalAIProviderClient({ baseUrl: 'https://example.test', development: false, now: Date.now, fetch: vi.fn() });
  expect(provider.screenObservation.reserve(request.requestId)).toBe(false);
});
it('rejects duplicate JSON response keys, including escaped spellings', async () => {
  const raw = '{"status":"available","provider":"openai","model":"gpt-6-astra","policyRevision":"screen-openai-2026-11","sta\\u0074us":"available"}';
  const f = setup(vi.fn(async () => new Response(raw, { headers: { 'Content-Type': 'application/json' } }))); f.screen.reserve(request.requestId);
  await expect(f.screen.getCapability(new AbortController().signal)).rejects.toThrow('JSON');
});
