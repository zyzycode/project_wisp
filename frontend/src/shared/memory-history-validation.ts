import type { MemoryHistoryReadDTO, MemoryHistoryResultDTO } from './ipc-contracts';
import { exactRecord, plainText } from './validation-primitives';
import { parseMemoryReadFailure, parseMemoryStreamRead } from './memory-ipc-validation';

export const MAX_MEMORY_HISTORY_PAIRS = 10;

export function parseMemoryHistoryRead(input: unknown): MemoryHistoryReadDTO {
  return parseMemoryStreamRead(input);
}

export function parseMemoryHistoryPair(input: unknown) {
  const pair = exactRecord(input, ['userText', 'assistantText']);
  return { userText: plainText(pair.userText, 240), assistantText: plainText(pair.assistantText, 2000) };
}

export function parseMemoryHistoryResult(input: unknown): MemoryHistoryResultDTO {
  const result = exactRecord(input, ['ok'], ['pairs', 'code']);
  if (result.ok === false) return parseMemoryReadFailure(input);
  exactRecord(input, ['ok', 'pairs']);
  if (result.ok !== true || !Array.isArray(result.pairs) || result.pairs.length > MAX_MEMORY_HISTORY_PAIRS) {
    throw new TypeError('Invalid saved dialogue');
  }
  return { ok: true, pairs: result.pairs.map(parseMemoryHistoryPair) };
}
