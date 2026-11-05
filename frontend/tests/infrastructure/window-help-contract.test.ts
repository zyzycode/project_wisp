import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { projectEventAwareChat, projectEventRequest } from '../../src/infrastructure/ai/backend-events-validation';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import type { BackendEventRequest, BackendEventAwareChatRequest } from '../../src/application/ports/backend-events-contract';
import { localCharacterFixture, providerRequest } from './backend-ai-fixture';
const help = JSON.parse(readFileSync('../docs/contracts/fixtures/desktop-backend-v1/window-help/request.help.json', 'utf8')) as BackendEventRequest;
const chat = JSON.parse(readFileSync('../docs/contracts/fixtures/desktop-backend-v1/window-help/request.chat.json', 'utf8')) as BackendEventAwareChatRequest;
const request = () => ({ requestId: help.requestId, event: help.event, characterSnapshot: localCharacterFixture(help.character), memoryContext: help.memory, locale: help.locale });
it('matches shared geometry-free help fixture and outcome-only previous initiative', () => {
  expect(projectEventRequest(request())).toEqual(help);
  const projected = projectEventAwareChat({ ...providerRequest(), previousInitiative: chat.previousInitiative });
  expect(projected.previousInitiative).toEqual(chat.previousInitiative);
  expect(JSON.stringify(projected.previousInitiative)).not.toMatch(/surface|geometry|screen|windowId/u);
  const forbiddenGeometry = { ...request(), event: { ...help.event, geometry: {} } };
  expect(() => projectEventRequest(forbiddenGeometry)).toThrow();
});
it('counts actual autonomous fetch dispatches only, including failed HTTP, with admission before dispatch', async () => {
  const sent = vi.fn(), admit = vi.fn(() => false);
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ requestId: help.requestId,
    error: { code: 'provider_unavailable' } }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
  const provider = new ExternalAIProviderClient({ baseUrl: 'https://example.com', development: false,
    now: () => 0, fetch: fetcher, admitEventDispatch: admit, eventDispatched: sent });
  await expect(provider.generateEvent(request())).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled(); expect(sent).not.toHaveBeenCalled();
  admit.mockReturnValue(true);
  await expect(provider.generateEvent(request())).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledOnce(); expect(sent).toHaveBeenCalledExactlyOnceWith(help.requestId);
});
it('reports network TypeError as unavailable while malformed successful responses remain invalid_response', async () => {
  const network = new ExternalAIProviderClient({ baseUrl: 'https://example.com', development: false,
    now: () => 0, fetch: vi.fn<typeof fetch>(async () => { throw new TypeError('private transport detail'); }) });
  await expect(network.generateEvent(request())).rejects.toThrow('unavailable');
  const malformed = new ExternalAIProviderClient({ baseUrl: 'https://example.com', development: false,
    now: () => 0, fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ requestId: help.requestId, text: 1 }),
      { headers: { 'Content-Type': 'application/json' } })) });
  await expect(malformed.generateEvent(request())).rejects.toThrow('invalid_response');
});
