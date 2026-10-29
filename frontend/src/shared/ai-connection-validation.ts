import type { AIConnectionCommandDTO, AIConnectionReadDTO, AIConnectionResultDTO, AIConnectionStatusDTO } from './ipc-contracts';
import { enumValue, exactRecord, plainText } from './validation-primitives';

function stream(value: unknown): string {
  const id = plainText(value, 128);
  if (id !== id.trim()) throw new TypeError('Invalid AI connection stream');
  return id;
}
export function parsePersonalAIKey(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Invalid AI connection key');
  const key = value.trim();
  if (!/^[\x21-\x7e]{1,512}$/u.test(key)) throw new TypeError('Invalid AI connection key');
  return key;
}
export function parseAIConnectionRead(value: unknown): AIConnectionReadDTO {
  const r = exactRecord(value, ['streamId']);
  return { streamId: stream(r.streamId) };
}
export function parseAIConnectionCommand(value: unknown): AIConnectionCommandDTO {
  const r = exactRecord(value, ['streamId', 'kind'], ['apiKey']);
  const streamId = stream(r.streamId);
  if (r.kind === 'save') {
    exactRecord(value, ['streamId', 'kind', 'apiKey']);
    return { streamId, kind: 'save', apiKey: parsePersonalAIKey(r.apiKey) };
  }
  exactRecord(value, ['streamId', 'kind']);
  return { streamId, kind: enumValue(r.kind, ['remove']) };
}
export function parseAIConnectionStatus(value: unknown): AIConnectionStatusDTO {
  const r = exactRecord(value, ['mode', 'hasSavedKey', 'secureStorageAvailable', 'failure']);
  if (typeof r.hasSavedKey !== 'boolean' || typeof r.secureStorageAvailable !== 'boolean') throw new TypeError('Invalid AI connection status');
  return {
    mode: enumValue(r.mode, ['offline', 'ready', 'unavailable', 'external']),
    hasSavedKey: r.hasSavedKey, secureStorageAvailable: r.secureStorageAvailable,
    failure: r.failure === null ? null : enumValue(r.failure, ['secure_storage_unavailable', 'storage_error', 'runtime_unavailable', 'startup_failed', 'startup_timeout']),
  };
}
export function parseAIConnectionResult(value: unknown): AIConnectionResultDTO {
  const r = exactRecord(value, ['ok'], ['restartRequired', 'code']);
  if (r.ok === true) {
    exactRecord(value, ['ok', 'restartRequired']);
    if (r.restartRequired !== true) throw new TypeError('Invalid AI connection result');
    return { ok: true, restartRequired: true };
  }
  exactRecord(value, ['ok', 'code']);
  if (r.ok !== false) throw new TypeError('Invalid AI connection result');
  return { ok: false, code: enumValue(r.code, ['invalid_input', 'stale', 'busy', 'externally_managed', 'secure_storage_unavailable', 'storage_error']) };
}
