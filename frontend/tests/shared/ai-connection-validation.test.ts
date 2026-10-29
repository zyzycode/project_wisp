import { describe, expect, it } from 'vitest';
import { parseAIConnectionCommand, parseAIConnectionRead, parseAIConnectionResult, parseAIConnectionStatus } from '../../src/shared/ai-connection-validation';

describe('personal AI connection wire boundary', () => {
  it('accepts only set-only save/remove and trimmed bounded ASCII keys', () => {
    expect(parseAIConnectionCommand({ streamId: 's', kind: 'save', apiKey: '  synthetic-key  ' })).toEqual({ streamId: 's', kind: 'save', apiKey: 'synthetic-key' });
    expect(parseAIConnectionCommand({ streamId: 's', kind: 'remove' })).toEqual({ streamId: 's', kind: 'remove' });
    expect(parseAIConnectionRead({ streamId: 's' })).toEqual({ streamId: 's' });
  });
  it.each(['', 'a b', 'ключ', 'x'.repeat(513), 'a\u0000b', 'a\nb'])('rejects malformed keys without their value in errors', apiKey => {
    expect(() => parseAIConnectionCommand({ streamId: 's', kind: 'save', apiKey })).toThrow('Invalid AI connection key');
  });
  it('rejects unknown fields and credential-bearing status/results', () => {
    expect(() => parseAIConnectionCommand({ streamId: 's', kind: 'remove', apiKey: 'secret' })).toThrow();
    expect(() => parseAIConnectionRead({ streamId: 's', apiKey: 'secret' })).toThrow();
    expect(() => parseAIConnectionStatus({ mode: 'ready', hasSavedKey: true, secureStorageAvailable: true, failure: null, apiKey: 'secret' })).toThrow();
    expect(() => parseAIConnectionResult({ ok: true, restartRequired: true, key: 'secret' })).toThrow();
    expect(() => parseAIConnectionResult({ ok: false, code: 'raw secret failure' })).toThrow();
  });
});
