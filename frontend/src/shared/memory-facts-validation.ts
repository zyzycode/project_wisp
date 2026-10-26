import type { MemoryFactsReadDTO, MemoryFactsResultDTO } from './ipc-contracts';
import { enumValue, exactRecord, plainText } from './validation-primitives';
const keys = ['user.display_name', 'user.preferred_address', 'user.favorite_topic', 'user.reply_style', 'user.cursor_game'] as const;
export function parseMemoryFactsRead(input: unknown): MemoryFactsReadDTO {
  const r = exactRecord(input, ['streamId']);
  const streamId = plainText(r.streamId, 128);
  if (streamId !== streamId.trim()) throw new TypeError('Invalid memory stream');
  return { streamId };
}
export function parseMemoryFactsResult(input: unknown): MemoryFactsResultDTO {
  const r = exactRecord(input, ['ok'], ['facts', 'code']);
  if (r.ok === false) {
    exactRecord(input, ['ok', 'code']);
    return { ok: false, code: enumValue(r.code, ['unavailable', 'busy', 'storage_full', 'corrupt', 'unsupported_version', 'invalid_data', 'conflict', 'stale', 'io_error']) };
  }
  exactRecord(input, ['ok', 'facts']);
  if (r.ok !== true || !Array.isArray(r.facts) || r.facts.length > 5) throw new TypeError('Invalid memory facts');
  const seen = new Set<string>();
  const facts = r.facts.map(inputFact => {
    const fact = exactRecord(inputFact, ['key', 'value']);
    const key = enumValue(fact.key, keys);
    if (seen.has(key)) throw new TypeError('Duplicate memory fact');
    seen.add(key);
    const value = plainText(fact.value, key === 'user.favorite_topic' ? 120 : 80, true);
    if (key === 'user.reply_style') enumValue(value, ['brief', 'detailed']);
    if (key === 'user.cursor_game') enumValue(value, ['like', 'dislike']);
    return { key, value };
  });
  return { ok: true, facts };
}
