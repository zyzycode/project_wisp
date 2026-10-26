import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import type { AIProviderRequest } from '../../src/application/ports/ai-provider.interface';
import type { BackendInteractionChatRequest } from '../../src/application/ports/backend-interaction-contract';
import { parseInteractionChatResponse, projectInteractionChat } from '../../src/infrastructure/ai/backend-interaction-validation';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
const fixture = (file: string): unknown => JSON.parse(readFileSync(`../docs/contracts/fixtures/desktop-backend-v1/beverage-preference/${file}`, 'utf8'));
function input(wire: BackendInteractionChatRequest): AIProviderRequest { return { requestId: wire.requestId, locale: wire.locale, characterSnapshot: wire.character, memoryContext: wire.memory, recentContext: wire.messages.slice(0, -1).map(m => ({ role: m.role === 'assistant' ? 'wisp' as const : 'user' as const, text: m.content, createdAt: '' })), userMessage: { id: 'u', text: wire.messages.at(-1)!.content, createdAt: '' }, interaction: { card: wire.card, effectPolicy: wire.effectPolicy }, ...(wire.previousTouch ? { interaction: { card: wire.card, effectPolicy: wire.effectPolicy, previousTouch: wire.previousTouch } } : {}), ...(wire.summary ? { summary: wire.summary } : {}), ...(wire.previousInitiative ? { previousInitiative: wire.previousInitiative } : {}), ...(wire.dialogueTopic ? { dialogueTopic: wire.dialogueTopic } : {}), ...(Object.hasOwn(wire, 'beveragePreference') ? { beveragePreference: wire.beveragePreference } : {}) }; }
const wire = fixture('request.opt-in.json') as BackendInteractionChatRequest;
const invalid = fixture('invalid.json') as { requests: { name: string; value: BackendInteractionChatRequest }[]; proposals: { name: string; value: unknown }[] };
it.each(['request.opt-in.json', 'request.recall-hypothesis.json', 'request.recall-confirmed.json', 'request.opt-in-current.json'])('matches shared preference request %s', file => { const wire = fixture(file) as BackendInteractionChatRequest; expect(projectInteractionChat(input(wire))).toEqual(wire); });
it.each(invalid.requests)('rejects invalid preference projection $name', test => { expect(() => projectInteractionChat(input(test.value))).toThrow(); });
it.each(invalid.proposals)('sanitizes invalid optional proposal $name while retaining successful text/appraisal', test => { const valid = fixture('response.valid.json') as Record<string, unknown>; const response = parseInteractionChatResponse({ ...valid, beverageProposal: test.value }, wire.requestId, wire.messages.at(-1)!.content, wire.effectPolicy, true); expect(response).not.toHaveProperty('beverageProposal'); expect(response.text).toEqual(valid.text); expect(response.appraisal).toEqual(valid.appraisal); });
it('discards any proposal without explicit per-turn opt-in', () => { expect(parseInteractionChatResponse(fixture('response.valid.json'), wire.requestId, wire.messages.at(-1)!.content, wire.effectPolicy)).not.toHaveProperty('beverageProposal'); });
it('keeps the no-field route identical', () => { const { beveragePreference: _preference, ...baseline } = wire; expect(projectInteractionChat(input(baseline))).toEqual(baseline); });
it('passes only a contextually valid proposal through the actual HTTP adapter', async () => { const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(fixture('response.valid.json')), { headers: { 'Content-Type': 'application/json' } })); const provider = new ExternalAIProviderClient({ baseUrl: 'https://example.com', development: false, now: () => 0, fetch: fetcher }); expect(await provider.generateResponse(input(wire))).toHaveProperty('beverageProposal'); expect(fetcher).toHaveBeenCalledTimes(1); });
it('atomically drops beverage at the byte cap while preserving all established baseline context', () => {
  const base = input(wire);
  const touch = JSON.parse(readFileSync('../docs/contracts/fixtures/desktop-backend-v1/interaction/request.chat.json', 'utf8')) as BackendInteractionChatRequest;
  const full: AIProviderRequest = { ...base, userMessage: { ...base.userMessage, text: '漢'.repeat(240) },
    characterSnapshot: { ...base.characterSnapshot, personality: { ...base.characterSnapshot.personality, aiSelfConcept: '漢'.repeat(500) } },
    recentContext: Array.from({ length: 6 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'wisp', text: '漢'.repeat(i % 2 === 0 ? 240 : 2000), createdAt: '2026-10-17T00:00:00.000Z' })),
    memoryContext: { facts: [{ key: 'user.display_name', value: '漢'.repeat(80) }, { key: 'user.preferred_address', value: '漢'.repeat(80) }, { key: 'user.favorite_topic', value: '漢'.repeat(120) }], episodes: Array.from({ length: 2 }, () => ({ kind: 'dialogue', userText: '漢'.repeat(240), assistantText: '漢'.repeat(400), occurredAt: '2026-10-17T00:00:00.000Z' })), characterPreferences: [] },
    previousInitiative: { kind: 'social_bid', text: '漢'.repeat(240), createdAt: '2026-10-17T00:00:00.000Z' },
    interaction: { ...base.interaction!, previousTouch: { ...touch.previousTouch!, publishedText: '漢'.repeat(240) } } };
  let found = false;
  for (let n = 1; n <= 1200; n++) {
    const candidate = { ...full, summary: { text: '漢'.repeat(n) } }, { beveragePreference: _preference, ...without } = candidate;
    const baseline = projectInteractionChat(without), enabled = projectInteractionChat(candidate);
    if (!enabled.beveragePreference && baseline.summary) { expect(enabled).toEqual(baseline); found = true; break; }
  }
  expect(found).toBe(true);
});
it.each(['tea\rplease', '\ud800', '😀'.repeat(121), 'tea\u0085please'])('discards optional proposal with forbidden controls or UTF-16 overflow', quote => { const response = fixture('response.valid.json') as Record<string, unknown>; expect(parseInteractionChatResponse({ ...response, beverageProposal: { value: 'tea', evidenceQuote: quote } }, wire.requestId, quote, wire.effectPolicy, true)).not.toHaveProperty('beverageProposal'); });
