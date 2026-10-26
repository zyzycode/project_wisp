import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import type { BackendAIMessage } from '../../src/application/ports/backend-ai-contract';
import { projectBackendRequest } from '../../src/infrastructure/ai/backend-request-projection';
import { fitChatRequestBytes } from '../../src/infrastructure/ai/backend-history-budget';
import { providerRequest } from './backend-ai-fixture';
const fixture = (name: string): unknown => JSON.parse(readFileSync(path.join(process.cwd(), '../docs/contracts/fixtures/desktop-backend-v1/history', name), 'utf8'));
function messages(value: unknown): BackendAIMessage[] {
  if (!Array.isArray(value) || value.some(item => !item || typeof item !== 'object' || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string')) throw new Error('Invalid fixture');
  return value;
}
it('projects all ten pairs from the shared fixture without local provenance or timestamps', () => {
  const raw = fixture('request.valid.json');
  if (!raw || typeof raw !== 'object' || !('messages' in raw)) throw new Error('Invalid fixture');
  const wire = messages(raw.messages);
  const request = providerRequest();
  request.recentContext = wire.slice(0, -1).map(item => ({ role: item.role === 'assistant' ? 'wisp' : 'user', text: item.content, createdAt: 'private timestamp', sourceMessageId: 'private source' }));
  request.userMessage.text = wire.at(-1)!.content;
  const projected = projectBackendRequest(request);
  expect(projected.messages).toEqual(wire);
  expect(JSON.stringify(projected)).not.toContain('private');
});
it('never emits malformed or overflowing shared fixture history', () => {
  const invalid = fixture('invalid.json');
  if (!Array.isArray(invalid)) throw new Error('Invalid fixture');
  for (const item of invalid) {
    const wire = messages(item.messages);
    const request = providerRequest();
    request.recentContext = wire.slice(0, -1).map(item => ({ role: item.role === 'assistant' ? 'wisp' : 'user', text: item.content, createdAt: '' }));
    request.userMessage.text = wire.at(-1)!.content;
    if (item.name === 'history-total-overflow') {
      const result = projectBackendRequest(request);
      expect(result.messages.slice(0, -1).reduce((sum, item) => sum + item.content.length, 0)).toBeLessThanOrEqual(8000);
      expect(result.messages.at(-1)?.content).toBe('current');
    } else expect(() => projectBackendRequest(request)).toThrow();
  }
});
it('removes whole oldest pairs at the JSON byte boundary and safely rejects mandatory-only overflow', () => {
  const messages: BackendAIMessage[] = Array.from({ length: 10 }, (_, index) => [{ role: 'user' as const, content: `${index}` }, { role: 'assistant' as const, content: '宇'.repeat(700) }]).flat();
  messages.push({ role: 'user', content: 'current' });
  const required = '宇'.repeat(5000);
  const request = fitChatRequestBytes({ messages, required });
  expect(new TextEncoder().encode(JSON.stringify(request)).byteLength).toBeLessThanOrEqual(32768);
  expect(request.required).toBe(required);
  expect(request.messages).toEqual(messages.slice(messages.length - request.messages.length));
  expect(request.messages.length % 2).toBe(1);
  expect(request.messages.length).toBeLessThan(21);
  expect(request.messages.at(-1)?.content).toBe('current');
  expect(() => fitChatRequestBytes({ messages: [messages.at(-1)!], required: '宇'.repeat(12000) })).toThrow('Request too large');
});
