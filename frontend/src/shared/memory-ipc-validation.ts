import type { ClearMemoryCommandDTO, ClearMemoryResultDTO, MemoryStatusDTO } from './ipc-contracts';
import { exactRecord } from './dialogue-ipc-validation';
const failures = ['unavailable', 'busy', 'storage_full', 'corrupt', 'unsupported_version', 'io_error'] as const;
function id(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new TypeError('Invalid memory command'); return value; }
function reason(value: unknown): (typeof failures)[number] { if (typeof value !== 'string' || !failures.some(code => code === value)) throw new TypeError('Invalid memory status'); return value as (typeof failures)[number]; }
export function parseClearMemoryCommand(input: unknown): ClearMemoryCommandDTO {
  const value = exactRecord(input, ['streamId', 'requestId', 'sequence']);
  if (typeof value.sequence !== 'number' || !Number.isSafeInteger(value.sequence) || value.sequence < 1) throw new TypeError('Invalid memory command');
  return { streamId: id(value.streamId), requestId: id(value.requestId), sequence: value.sequence };
}
export function parseClearMemoryResult(input: unknown): ClearMemoryResultDTO {
  const base = exactRecord(input, ['requestId', 'status'], ['reason']);
  if (base.status === 'cleared') { exactRecord(input, ['requestId', 'status']); return { requestId: id(base.requestId), status: 'cleared' }; }
  if (base.status !== 'failed') throw new TypeError('Invalid memory result');
  return { requestId: id(base.requestId), status: 'failed', reason: base.reason === 'stale' ? 'stale' : reason(base.reason) };
}
export function parseMemoryStatus(input: unknown): MemoryStatusDTO {
  const value = exactRecord(input, ['mode'], ['reason', 'characterRestore']);
  if (value.mode === 'initializing') { exactRecord(input, ['mode']); return { mode: 'initializing' }; }
  if (value.mode === 'volatile') { exactRecord(input, ['mode', 'reason']); return { mode: 'volatile', reason: reason(value.reason) }; }
  if (value.mode !== 'persistent' || !['restored', 'default', 'invalid_snapshot', 'unsupported_snapshot'].includes(String(value.characterRestore))) throw new TypeError('Invalid memory status');
  exactRecord(input, ['mode', 'characterRestore']);
  return { mode: 'persistent', characterRestore: value.characterRestore as Extract<MemoryStatusDTO, { mode: 'persistent' }>['characterRestore'] };
}
