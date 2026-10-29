import { describe, expect, it } from 'vitest';
import { parseVoiceTranscribe, parseVoiceResult, parseVoiceText } from '../../src/shared/voice-input-validation';
const base = { streamId: 'stream', conversationId: 'conversation', requestId: 'request', language: 'ru', samples: [0, -1, 1] };
describe('voice IPC validation', () => {
  it('accepts bounded PCM, rejects excess keys, sparse/nonfinite/unbounded audio', () => {
    expect(parseVoiceTranscribe(base)).toEqual(base);
    for (const samples of [[], new Array(2), [NaN], [Infinity], [1.01], new Array(480001).fill(0)]) expect(() => parseVoiceTranscribe({ ...base, samples })).toThrow();
    expect(() => parseVoiceTranscribe({ ...base, path: '/audio' })).toThrow();
    expect(() => parseVoiceTranscribe({ ...base, language: 'auto' })).toThrow();
  });
  it('does not execute accessors or disclose internal errors', () => {
    const samples = [0]; Object.defineProperty(samples, '0', { get: () => { throw new Error('must not run'); } });
    expect(() => parseVoiceTranscribe({ ...base, samples })).toThrow('Invalid voice audio');
    expect(() => parseVoiceResult({ ok: false, code: '/internal' }, parseVoiceText)).toThrow();
    expect(() => parseVoiceResult({ ok: true, value: { text: 'x'.repeat(241) } }, parseVoiceText)).toThrow();
  });
});
