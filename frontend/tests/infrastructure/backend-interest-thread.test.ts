import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AIProviderRequest } from '../../src/application/ports/ai-provider.interface';
import type { BackendInteractionChatRequest } from '../../src/application/ports/backend-interaction-contract';
import { projectInteractionChat } from '../../src/infrastructure/ai/backend-interaction-validation';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';

const fixture = (name: string): unknown => JSON.parse(readFileSync(`../docs/contracts/fixtures/desktop-backend-v1/interest-thread/${name}`, 'utf8'));
const followUp = fixture('request.follow-up.json') as BackendInteractionChatRequest;
const invalid = fixture('invalid.json') as { requests: { name: string; value: BackendInteractionChatRequest }[] };
function input(wire = followUp): AIProviderRequest {
  return { requestId: wire.requestId, locale: wire.locale, characterSnapshot: wire.character, memoryContext: wire.memory,
    recentContext: [], userMessage: { id: 'local', text: wire.messages.at(-1)!.content, createdAt: 'local' },
    previousInitiative: wire.previousInitiative, summary: wire.summary, dialogueTopic: wire.dialogueTopic,
    interaction: { card: wire.card, effectPolicy: wire.effectPolicy, previousTouch: wire.previousTouch } };
}
const provider = (fetcher: typeof fetch) => new ExternalAIProviderClient({ baseUrl: 'https://example.com', development: false, now: Date.now, fetch: fetcher });
const reply = () => new Response(JSON.stringify({ requestId: followUp.requestId, text: 'Как сейчас дела с этой темой?',
  appraisal: { category: 'neutral', intensity: 'low', confidence: 'clear' } }), { headers: { 'Content-Type': 'application/json' } });
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each(['request.follow-up.json', 'request.reply.json'])('projects only the shared bounded quotation: %s', name => {
  const wire = fixture(name) as BackendInteractionChatRequest;
  expect(projectInteractionChat(input(wire))).toEqual(wire);
  expect(Object.keys(projectInteractionChat(input(wire)).dialogueTopic!)).toEqual(['mode', 'text', 'statedAt']);
});
it.each(invalid.requests)('rejects shared invalid topic $name before HTTP', async entry => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(provider(fetcher).generateResponse(input(entry.value))).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it('declares capability, omits absent topic and accepts the UTF-16 boundary', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply());
  const adapter = provider(fetcher);
  expect(adapter.supportsDialogueTopic).toBe(true);
  const request = { ...input(), dialogueTopic: undefined };
  const baseline = projectInteractionChat(request);
  expect(baseline).not.toHaveProperty('dialogueTopic');
  expect(projectInteractionChat({ ...request, dialogueTopic: { ...followUp.dialogueTopic!, text: '😀'.repeat(80) } }).dialogueTopic?.text).toHaveLength(160);
  await adapter.generateResponse(input());
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(followUp);
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
});
it('drops the whole topic without evicting baseline history, summary or memory', () => {
  const request = input();
  const full: AIProviderRequest = { ...request, dialogueTopic: undefined,
    userMessage: { ...request.userMessage, text: '漢'.repeat(240) },
    characterSnapshot: { ...request.characterSnapshot, personality: { ...request.characterSnapshot.personality, aiSelfConcept: '漢'.repeat(500) } },
    recentContext: Array.from({ length: 6 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'wisp', text: '漢'.repeat(i % 2 === 0 ? 240 : 2000), createdAt: '2026-10-17T00:00:00.000Z' })),
    memoryContext: { facts: [{ key: 'user.display_name', value: '漢'.repeat(80) }, { key: 'user.preferred_address', value: '漢'.repeat(80) }, { key: 'user.favorite_topic', value: '漢'.repeat(120) }],
      episodes: Array.from({ length: 2 }, () => ({ kind: 'dialogue', userText: '漢'.repeat(240), assistantText: '漢'.repeat(400), occurredAt: '2026-10-17T00:00:00.000Z' })), characterPreferences: [] },
    previousInitiative: { kind: 'social_bid', text: '漢'.repeat(240), createdAt: '2026-10-17T00:00:00.000Z' },
    interaction: { ...request.interaction!, previousTouch: { ...followUp.previousTouch!, publishedText: '漢'.repeat(240) } } };
  let dropped = false;
  for (let length = 1; length <= 1200; length++) {
    const candidate = { ...full, summary: { text: '漢'.repeat(length) } };
    const baseline = projectInteractionChat(candidate);
    const withTopic = projectInteractionChat({ ...candidate, dialogueTopic: { ...followUp.dialogueTopic!, text: '漢'.repeat(160) } });
    if (withTopic.dialogueTopic !== undefined) continue;
    expect(withTopic).toEqual(baseline);
    expect(withTopic.summary).toEqual(candidate.summary);
    expect(withTopic.messages).toHaveLength(7);
    dropped = true; break;
  }
  expect(dropped).toBe(true);
});
