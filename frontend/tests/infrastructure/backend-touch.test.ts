import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { projectInteractionTouch as projectTouchRequest, parseInteractionTouchResponse } from '../../src/infrastructure/ai/backend-interaction-validation';
import { emptyMemoryContext } from '../../src/application/services/memory-recall';
import { providerRequest } from './backend-ai-fixture';
import type { BackendInteractionTouchRequest } from '../../src/application/ports/backend-interaction-contract';

const parseTouchResponse = (value: unknown, id: string) => parseInteractionTouchResponse(value, id, 'suppressed');

const wire = JSON.parse(readFileSync('../docs/contracts/fixtures/desktop-backend-v1/request.touch.json', 'utf8')) as BackendInteractionTouchRequest;
const request = () => ({ interaction: { card: wire.card, effectPolicy: wire.effectPolicy }, requestId: wire.requestId, event: { type: 'user_touch' as const, variant: 'touch' as const, occurredAt: '2026-10-08T00:00:00.000Z' },
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
    return new Response(JSON.stringify({ requestId: wire.requestId, text: 'Приятно!', appraisal: { category: 'neutral', intensity: 'low', confidence: 'clear' } }), { headers: { 'Content-Type': 'application/json' } });
  });
  const f = fixture(fetcher);
  await expect(f.provider.generateEvent(request())).resolves.toEqual({ requestId: wire.requestId, replyText: 'Приятно!', appraisal: { category: 'neutral', intensity: 'low', confidence: 'clear' } });
  for (let i = 0; i < 105; i++) await f.provider.generateEvent(request());
  expect(fetcher).toHaveBeenCalledTimes(106);
});
it('rejects a response correlated to another touch', () => {
  expect(() => parseTouchResponse({ requestId: 'wrong', text: 'OK', appraisal: { category: 'neutral', intensity: 'low', confidence: 'clear' } }, wire.requestId)).toThrow();
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
