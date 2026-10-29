import { expect, it, vi } from 'vitest';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { parseObservationRequest } from '../../src/infrastructure/ai/backend-observation-validation';
import { parseSummaryRequest } from '../../src/infrastructure/ai/backend-summary-validation';
import { fixture, providerRequest } from './backend-ai-fixture';
const token = 'b'.repeat(64);

it.each(['https://example.com', 'http://localhost:3456', 'http://127.0.0.1:3456/path', 'http://127.0.0.1:3456?key=value'])('refuses to send the local session token to %s', baseUrl => {
  expect(() => new ExternalAIProviderClient({ baseUrl, sessionToken: token, development: true, now: Date.now })).toThrow('Invalid local backend configuration');
});
it('authenticates all five existing semantic operations without provider keys or redirects', async () => {
  const request = providerRequest();
  const eventRequest = { ...request, locale: 'ru' as const, memoryContext: request.memoryContext ?? { facts: [], episodes: [], characterPreferences: [] } };
  const observation = parseObservationRequest(fixture('observation/request.valid.json'));
  const summary = parseSummaryRequest(fixture('summary/request.summary.json'));
  const operations: readonly [string, (provider: ExternalAIProviderClient) => Promise<unknown>][] = [
    ['chat', provider => provider.generateResponse(request)],
    ['touch', provider => provider.generateEvent({ ...eventRequest, event: { type: 'user_touch', variant: 'touch', occurredAt: '2026-10-29T00:00:00.000Z' } })],
    ['events', provider => provider.generateEvent({ ...eventRequest, event: { type: 'social_bid_started', occurredAt: '2026-10-29T00:00:00.000Z' } })],
    ['summary', provider => provider.generateSummary({ requestId: summary.requestId, pairs: summary.pairs, locale: summary.locale }, new AbortController().signal)],
    ['observation', provider => provider.generateObservation({ requestId: observation.requestId, locale: observation.locale, characterSnapshot: observation.character, observation: observation.observation }, new AbortController().signal)],
  ];
  for (const [name, operation] of operations) {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{"error":"unauthorized"}', { status: 401, headers: { 'Content-Type': 'application/json' } }));
    const provider = new ExternalAIProviderClient({ baseUrl: 'http://127.0.0.1:3456', development: false, sessionToken: token, now: Date.now, fetch: fetcher });
    await expect(operation(provider)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(`http://127.0.0.1:3456/v1/${name}`);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: `Bearer ${token}` }, redirect: 'error', credentials: 'omit' });
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).not.toContain(token);
  }
});
it('does not add any authentication to an external operator deployment', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('offline'); });
  const provider = new ExternalAIProviderClient({ baseUrl: 'https://external.example', development: false, now: Date.now, fetch: fetcher });
  await provider.generateResponse(providerRequest());
  expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ 'Content-Type': 'application/json', Accept: 'application/json' });
});
