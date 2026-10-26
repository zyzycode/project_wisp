import { expect, it } from 'vitest';
import type { AIProviderRequest } from '../../src/application/ports/ai-provider.interface';
import { projectEventAwareChat } from '../../src/infrastructure/ai/backend-events-validation';
import { projectBackendMemoryRequest } from '../../src/infrastructure/ai/backend-memory-validation';
import { providerRequest } from './backend-ai-fixture';
it('retains previous initiative and current user by evicting an optional episode at the intermediary byte boundary', () => {
  const baseRequest = providerRequest();
  Object.assign(baseRequest.characterSnapshot.personality, { aiSelfConcept: '宇'.repeat(500) });
  baseRequest.userMessage.text = '宇'.repeat(240);
  baseRequest.recentContext = Array.from({ length: 10 }, () => [{ role: 'user' as const, text: '宇'.repeat(240), createdAt: '' }, { role: 'wisp' as const, text: '宇'.repeat(560), createdAt: '' }]).flat();
  const request: AIProviderRequest = { ...baseRequest, memoryContext: { facts: [{ key: 'user.display_name', value: '宇'.repeat(80) }, { key: 'user.preferred_address', value: '宇'.repeat(80) }, { key: 'user.favorite_topic', value: '宇'.repeat(120) }], episodes: [{ kind: 'dialogue', userText: '宇'.repeat(240), assistantText: '宇'.repeat(400), occurredAt: '2026-10-26T00:00:00.000Z' }, { kind: 'dialogue', userText: '宇'.repeat(240), assistantText: '宇'.repeat(400), occurredAt: '2026-10-26T00:00:00.000Z' }], characterPreferences: [] },
    previousInitiative: { kind: 'social_bid', text: '宇'.repeat(240), createdAt: '2026-10-26T00:00:00.000Z' } };
  const base = projectBackendMemoryRequest(request);
  expect(new TextEncoder().encode(JSON.stringify(base)).byteLength).toBe(32565);
  const projected = projectEventAwareChat(request);
  expect(projected.messages).toHaveLength(21);
  expect(projected.memory.episodes).toHaveLength(1);
  expect(new TextEncoder().encode(JSON.stringify(projected)).byteLength).toBeLessThanOrEqual(32768);
  expect(projected.messages.at(-1)?.content).toBe(request.userMessage.text);
  expect(projected.previousInitiative?.text).toBe('宇'.repeat(240));
});
