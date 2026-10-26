import { expect, it } from 'vitest';
import { mapProviderResponseToBehaviorIntent } from '../../src/application/services/provider-response-intent-mapper';

it('preserves successful provider suggestions, reply identity and normal admission priority', () => {
  expect(mapProviderResponseToBehaviorIntent({
    requestId: 'request-1', status: 'ok', reply: { text: 'Ответ' },
    confidence: 0.9, suggestedBehavior: 'play', suggestedMood: 'happy',
  })).toEqual({
    kind: 'play', source: 'provider', priority: 'normal',
    replyText: 'Ответ', moodHint: 'happy', requestId: 'request-1',
  });
});
