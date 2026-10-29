import { expect, it } from 'vitest';
import { MAX_VOICE_SAMPLES } from '../../src/shared/voice-output-contracts';
import { parsePlayback, parsePlaybackAck, parseReplyIdentity, parseVoiceEnabled, parseOutputResult, parseOutputNull } from '../../src/shared/voice-output-validation';
it('rejects arbitrary text, extra fields, malformed identity and nonboolean settings', () => {
  const reply = { streamId: 's', conversationId: 'c', requestId: 'r' };
  expect(parseReplyIdentity(reply)).toEqual(reply);
  for (const value of [{ ...reply, text: 'injected' }, { ...reply, requestId: '' }, { ...reply, streamId: 'x'.repeat(129) }, null]) expect(() => parseReplyIdentity(value)).toThrow();
  expect(() => parseVoiceEnabled({ enabled: 'true' })).toThrow();
  expect(() => parsePlaybackAck({ playbackId: 'p', text: 'extra' })).toThrow();
  expect(() => parseOutputResult({ ok: false, code: 'secret provider detail' }, parseOutputNull)).toThrow();
});
it('bounds sample rate, PCM type, size, amplitude and finiteness before playback', () => {
  const good = { playbackId: 'p', sampleRate: 24000, samples: new Float32Array([0.1]) };
  expect(parsePlayback(good)).toEqual(good);
  for (const value of [{ ...good, sampleRate: 16000 }, { ...good, samples: [0.1] }, { ...good, samples: new Float32Array() }, { ...good, samples: new Float32Array([NaN]) }, { ...good, samples: new Float32Array([1.1]) }, { ...good, samples: new Float32Array(MAX_VOICE_SAMPLES + 1) }]) expect(() => parsePlayback(value)).toThrow();
});
