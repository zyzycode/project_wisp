import { expect, it } from 'vitest';
import type { AIProviderContextMessage } from '../../src/application/ports/ai-provider.interface';
import { boundMemoryContext } from '../../src/application/services/memory-context';
import { projectBackendRequest } from '../../src/infrastructure/ai/backend-request-projection';
import { providerRequest } from '../infrastructure/backend-ai-fixture';
const pair = (index: number, assistant = 'reply'): AIProviderContextMessage[] => [
  { role: 'user', text: `topic ${index}`, createdAt: '' }, { role: 'wisp', text: assistant, createdAt: '' },
];
it('keeps an early reference through six completed pairs all the way into wire messages', () => {
  const recentContext = boundMemoryContext(Array.from({ length: 6 }, (_, i) => pair(i)).flat());
  const projected = projectBackendRequest({ ...providerRequest(), recentContext, userMessage: { id: 'current', text: 'Вернёмся к topic 0', createdAt: '' } });
  expect(projected.messages).toHaveLength(13);
  expect(projected.messages[0]).toEqual({ role: 'user', content: 'topic 0' });
  expect(projected.messages.at(-1)).toEqual({ role: 'user', content: 'Вернёмся к topic 0' });
});
it('uses a continuous suffix of whole pairs and never cuts a message to fit the budget', () => {
  const input = [...pair(0), ...pair(1, 'x'.repeat(2000)), ...pair(2, 'y'.repeat(2000))];
  const result = boundMemoryContext(input, { maxMessages: 20, maxTotalCharacters: 2010, maxCharactersPerMessage: 2000 });
  expect(result).toEqual(pair(2, 'y'.repeat(2000)));
  expect(boundMemoryContext(pair(3, '😀'.repeat(1001)))).toEqual([]);
  expect(input[3]?.text).toHaveLength(2000);
});
it('does not join older history across an incomplete latest pair', () => {
  expect(boundMemoryContext([...pair(0), { role: 'user', text: 'unfinished', createdAt: '' }])).toEqual([]);
});
it('preserves ten complete pairs as a finite input bound', () => {
  const recentContext = boundMemoryContext(Array.from({ length: 12 }, (_, i) => pair(i)).flat());
  expect(recentContext).toHaveLength(20);
  expect(recentContext[0]?.text).toBe('topic 2');
  expect(projectBackendRequest({ ...providerRequest(), recentContext }).messages).toHaveLength(21);
});
