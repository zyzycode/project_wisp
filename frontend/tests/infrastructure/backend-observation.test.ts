import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { parseObservationRequest, projectObservationRequest, parseObservationResponse, parseObservationError } from '../../src/infrastructure/ai/backend-observation-validation';
import { providerRequest } from './backend-ai-fixture';
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(process.cwd(), '../docs/contracts/fixtures/desktop-backend-v6', name), 'utf8'));
const wire = parseObservationRequest(fixture('request.valid.json'));
const input = { requestId: wire.requestId, locale: wire.locale, characterSnapshot: wire.character, observation: wire.observation };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const client = (fetcher: typeof fetch, apiVersion: 1 | 2 | 3 | 5 = 1) => new ExternalAIProviderClient({ baseUrl: 'https://example.com/api', development: false, apiVersion, now: Date.now, fetch: fetcher });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000000); });
afterEach(() => vi.useRealTimers());
it('shares valid, empty and hostile untrusted title corpus unchanged', () => {
  for (const name of ['request.valid.json', 'request.empty-title.json', 'request.hostile-title.json']) expect(parseObservationRequest(fixture(name))).toEqual(fixture(name));
  expect(projectObservationRequest(input)).toEqual(wire); expect(parseObservationResponse(fixture('response.success.json'), wire.requestId)).toBe('Может, сделать небольшую паузу?');
  expect(() => parseObservationError(fixture('response.error.json'), wire.requestId, 503)).not.toThrow();
});
const invalid = fixture('invalid.json') as readonly { name: string; kind: 'request' | 'response'; value: unknown; raw?: string }[];
it.each(invalid)('rejects shared corpus $name', async entry => {
  if (entry.raw) {
    if (entry.kind === 'request') { expect(new TextEncoder().encode(entry.raw).byteLength).toBeGreaterThan(32768); return; }
    const fetcher = vi.fn<typeof fetch>(async () => new Response(entry.raw, { headers: { 'Content-Type': 'application/json' } }));
    await expect(client(fetcher).generateObservation(input, new AbortController().signal)).rejects.toThrow(); return;
  }
  expect(() => entry.kind === 'request' ? parseObservationRequest(entry.value) : parseObservationResponse(entry.value, wire.requestId)).toThrow();
});
it.each([1, 2, 3, 5] as const)('uses independent /v6/observation with chat API v%s and exact projection', async version => {
  const fetcher = vi.fn<typeof fetch>(async () => json(fixture('response.success.json'))), provider = client(fetcher, version);
  expect(await provider.getStatus()).toEqual({ kind: 'ready' }); expect(fetcher).not.toHaveBeenCalled();
  await expect(provider.generateObservation(input, new AbortController().signal)).resolves.toBe('Может, сделать небольшую паузу?');
  expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://example.com/api/v6/observation'); expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(wire);
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' }); expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['offline', '401', '403', '404', '502', '503', '504', 'content-type', 'invalid-json', 'oversize', 'utf8'] as const)('silently rejects %s without retry/probe/downgrade', async failure => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    if (failure === 'offline') throw new Error('offline');
    if (failure === 'content-type') return new Response('{}');
    if (failure === 'invalid-json') return new Response('{', { headers: { 'Content-Type': 'application/json' } });
    if (failure === 'oversize') return new Response(' '.repeat(16385), { headers: { 'Content-Type': 'application/json' } });
    if (failure === 'utf8') return new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } });
    return json(fixture('response.error.json'), Number(failure));
  });
  const provider = client(fetcher); await expect(provider.generateObservation(input, new AbortController().signal)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1); expect(await provider.getStatus()).toEqual({ kind: 'ready' });
});
it('bounds public timeout by3s but retains draining slot until actual fetch settlement', async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(yes => { resolve = yes; })).mockImplementation(async () => json({ version: 1, requestId: providerRequest().requestId, text: 'Chat reply' }));
  const provider = client(fetcher), controller = new AbortController();
  const pending = provider.generateObservation(input, controller.signal); const rejection = expect(pending).rejects.toThrow();
  controller.abort(); await flush(); expect(await provider.getStatus()).toEqual({ kind: 'thinking', activeRequestId: wire.requestId });
  await expect(provider.generateResponse(providerRequest())).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2999); expect(await provider.getStatus()).toMatchObject({ kind: 'thinking' });
  await vi.advanceTimersByTimeAsync(1); await rejection; expect(await provider.getStatus()).toMatchObject({ kind: 'thinking' });
  await expect(provider.generateResponse(providerRequest())).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
  resolve(json(fixture('response.success.json'))); await flush(); expect(await provider.getStatus()).toEqual({ kind: 'ready' });
  await provider.generateResponse(providerRequest()); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('treats exact3000ms response as late and rejects pre-aborted before fetch', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => { vi.setSystemTime(Date.now() + 3000); return json(fixture('response.success.json')); });
  await expect(client(fetcher).generateObservation(input, new AbortController().signal)).rejects.toThrow();
  const controller = new AbortController(); controller.abort(); await expect(client(fetcher).generateObservation(input, controller.signal)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not start observation while chat owns the client', async () => {
  let resolve!: (response: Response) => void; const fetcher = vi.fn<typeof fetch>(() => new Promise(yes => { resolve = yes; }));
  const provider = client(fetcher), pending = provider.generateResponse(providerRequest());
  await expect(provider.generateObservation(input, new AbortController().signal)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
  resolve(json({ version: 1, requestId: providerRequest().requestId, text: 'reply' })); await pending;
});
