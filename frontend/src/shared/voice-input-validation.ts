import type { VoiceCaptureContextDTO, VoiceInputResultDTO, VoiceModelStatusDTO, VoiceTranscribeDTO } from './ipc-contracts';
import { enumValue, exactRecord, plainText } from './validation-primitives';
export function parseVoiceContext(value: unknown): VoiceCaptureContextDTO {
  const r = exactRecord(value, ['streamId', 'conversationId']);
  return { streamId: plainText(r.streamId, 128), conversationId: plainText(r.conversationId, 128) };
}
export function parseVoiceCancel(value: unknown): { readonly requestId: string } {
  return { requestId: plainText(exactRecord(value, ['requestId']).requestId, 128) };
}
export function parseVoiceTranscribe(value: unknown): VoiceTranscribeDTO {
  const r = exactRecord(value, ['streamId', 'conversationId', 'requestId', 'language', 'samples']);
  const samples = r.samples;
  if (!Array.isArray(samples) || samples.length < 1 || samples.length > 480000) throw new TypeError('Invalid voice audio');
  for (let i = 0; i < samples.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(samples, String(i));
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'number' || !Number.isFinite(descriptor.value) || Math.abs(descriptor.value) > 1) throw new TypeError('Invalid voice audio');
  }
  return { ...parseVoiceContext({ streamId: r.streamId, conversationId: r.conversationId }), requestId: plainText(r.requestId, 128), language: enumValue(r.language, ['ru', 'en']), samples };
}
export function parseVoiceStatus(value: unknown): VoiceModelStatusDTO {
  const r = exactRecord(value, ['state', 'downloadedBytes', 'totalBytes']);
  if (typeof r.downloadedBytes !== 'number' || typeof r.totalBytes !== 'number' || !Number.isSafeInteger(r.downloadedBytes) || !Number.isSafeInteger(r.totalBytes) || r.downloadedBytes < 0 || r.totalBytes < r.downloadedBytes) throw new TypeError('Invalid voice status');
  return { state: enumValue(r.state, ['not_installed', 'downloading', 'ready', 'error']), downloadedBytes: r.downloadedBytes, totalBytes: r.totalBytes };
}
export function parseVoiceRequest(value: unknown): { readonly requestId: string } { return parseVoiceCancel(value); }
export function parseVoiceText(value: unknown): { readonly text: string } { return { text: plainText(exactRecord(value, ['text']).text, 240) }; }
export function parseVoiceNull(value: unknown): null { if (value !== null) throw new TypeError('Invalid voice result'); return null; }
export function parseVoiceResult<T>(value: unknown, parse: (value: unknown) => T): VoiceInputResultDTO<T> {
  const r = exactRecord(value, ['ok'], ['value', 'code']);
  if (r.ok === true) { exactRecord(value, ['ok', 'value']); return { ok: true, value: parse(r.value) }; }
  exactRecord(value, ['ok', 'code']);
  if (r.ok !== false) throw new TypeError('Invalid voice result');
  return { ok: false, code: enumValue(r.code, ['unavailable', 'not_ready', 'busy', 'cancelled', 'timeout', 'download_failed', 'integrity_failed', 'invalid_audio', 'recognition_failed', 'invalid_request', 'stale_context', 'text_too_long', 'empty_transcript']) };
}
