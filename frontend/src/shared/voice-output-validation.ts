import type { ReplyIdentityDTO, VoiceOutputError, VoiceOutputResult, VoiceOutputStatusDTO, VoicePlaybackDTO } from './voice-output-contracts';
import { MAX_VOICE_SAMPLES } from './voice-output-contracts';

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new TypeError('Invalid voice output');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError('Invalid voice identity');
  return value;
}
export function parseReplyIdentity(value: unknown): ReplyIdentityDTO {
  const r = record(value, ['streamId', 'conversationId', 'requestId']);
  return { streamId: id(r.streamId), conversationId: id(r.conversationId), requestId: id(r.requestId) };
}
export function parseVoiceEnabled(value: unknown): { readonly enabled: boolean } {
  const r = record(value, ['enabled']);
  if (typeof r.enabled !== 'boolean') throw new TypeError('Invalid voice setting');
  return { enabled: r.enabled };
}
export function parsePlaybackAck(value: unknown): { readonly playbackId: string } {
  return { playbackId: id(record(value, ['playbackId']).playbackId) };
}
export function parseOutputStatus(value: unknown): VoiceOutputStatusDTO {
  const r = record(value, ['enabled', 'ready', 'active']);
  if (typeof r.enabled !== 'boolean' || typeof r.ready !== 'boolean' || typeof r.active !== 'boolean') throw new TypeError('Invalid voice status');
  return { enabled: r.enabled, ready: r.ready, active: r.active };
}
export function parsePlayback(value: unknown): VoicePlaybackDTO {
  const r = record(value, ['playbackId', 'sampleRate', 'samples']);
  if (r.sampleRate !== 24000 || !(r.samples instanceof Float32Array) || r.samples.length < 1 || r.samples.length > MAX_VOICE_SAMPLES || !r.samples.every(n => Number.isFinite(n) && Math.abs(n) <= 1)) throw new TypeError('Invalid voice audio');
  return { playbackId: id(r.playbackId), sampleRate: 24000, samples: r.samples };
}
export function parseOutputNull(value: unknown): null { if (value !== null) throw new TypeError('Invalid voice result'); return null; }
const errors: readonly VoiceOutputError[] = ['invalid_request', 'unavailable', 'disabled', 'stale', 'consumed', 'cancelled', 'timeout', 'synthesis_failed'];
export function parseOutputResult<T>(value: unknown, parse: (value: unknown) => T): VoiceOutputResult<T> {
  if (!value || typeof value !== 'object' || !('ok' in value)) throw new TypeError('Invalid voice result');
  if (value.ok === true) return { ok: true, value: parse(record(value, ['ok', 'value']).value) };
  const r = record(value, ['ok', 'code']);
  if (r.ok !== false || !errors.some(code => code === r.code)) throw new TypeError('Invalid voice error');
  return { ok: false, code: r.code as VoiceOutputError };
}
