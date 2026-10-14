import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { projectTouchRequest, parseTouchResponse } from '../../src/infrastructure/ai/backend-touch-validation';
import { emptyMemoryContext } from '../../src/application/services/memory-recall';
import { providerRequest } from './backend-ai-fixture';
import type { BackendTouchRequest } from '../../src/application/ports/backend-touch-contract';

const wire = JSON.parse(readFileSync('../docs/contracts/fixtures/desktop-backend-v1/request.touch.json', 'utf8')) as BackendTouchRequest;
const request = () => ({ requestId: wire.requestId, event: { type: 'user_touch' as const, variant: 'stroke' as const, occurredAt: '2026-10-08T00:00:00.000Z' },
  characterSnapshot: wire.character, memoryContext: emptyMemoryContext(), locale: wire.locale });
function fixture(fetcher: typeof fetch) {

  const provider = new ExternalAIProviderClient({ baseUrl: 'https://example.com', development: false, now: Date.now, fetch: fetcher });
  return { provider };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => vi.useRealTimers());
it('matches shared fixture and sends no dialogue or memory', () => {
  const projected = projectTouchRequest(request()); expect(projected).toEqual(wire);
  expect(projected).not.toHaveProperty('messages'); expect(projected).not.toHaveProperty('memory');
});
it('uses v1 touch without local quotas even when autonomous events are disabled', async () => {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toBe('https://example.com/v1/touch'); expect(JSON.parse(String(init?.body))).toEqual(wire);
    return new Response(JSON.stringify({ version: 1, requestId: wire.requestId, text: 'Приятно!' }), { headers: { 'Content-Type': 'application/json' } });
  });
  const f = fixture(fetcher);
  await expect(f.provider.generateEvent(request())).resolves.toEqual({ requestId: wire.requestId, replyText: 'Приятно!' });
  for (let i = 0; i < 105; i++) await f.provider.generateEvent(request());
  expect(fetcher).toHaveBeenCalledTimes(106);
});
it.each([401, 503])('keeps HTTP %s failures silent without a cooldown', async status => {
  const f = fixture(async () => new Response(JSON.stringify({ version: 1, requestId: wire.requestId, error: { code: 'upstream_unavailable' } }), { status, headers: { 'Content-Type': 'application/json' } }));
  await expect(f.provider.generateEvent(request())).rejects.toThrow(); await expect(f.provider.getStatus()).resolves.toEqual({ kind: 'ready' });
});
it.each([{ text: '' }, { text: 'x'.repeat(241) }, { decision: {} }, { requestId: 'wrong' }])('rejects malformed text response %j', extra => {
  expect(() => parseTouchResponse({ version: 1, requestId: wire.requestId, text: 'OK', ...extra }, wire.requestId)).toThrow();
});
it('cancels touch and keeps the shared transport busy until cancellation settles', async () => {
  let release!: () => void;
  const fetcher = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { release = () => reject(new Error('cancelled')); });
  }));
  const f = fixture(fetcher), pending = f.provider.generateEvent(request());
  const rejected = expect(pending).rejects.toThrow(); f.provider.cancel(wire.requestId);
  await expect(f.provider.generateResponse(providerRequest())).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1); release(); await rejected;
  await expect(f.provider.getStatus()).resolves.toEqual({ kind: 'ready' });
});
it('times out without retry or accepting a late response', async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(() => new Promise(yes => { resolve = yes; }));
  const f = fixture(fetcher), pending = f.provider.generateEvent(request());
  const rejected = expect(pending).rejects.toThrow(); await vi.advanceTimersByTimeAsync(12000); await rejected;
  resolve(new Response(JSON.stringify({ version: 1, requestId: wire.requestId, text: 'Late' }), { headers: { 'Content-Type': 'application/json' } }));
  expect(fetcher).toHaveBeenCalledTimes(1); await expect(f.provider.getStatus()).resolves.toEqual({ kind: 'ready' });
});
