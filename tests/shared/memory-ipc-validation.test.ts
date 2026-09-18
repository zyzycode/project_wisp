import { expect, it } from 'vitest';
import { parseClearMemoryCommand, parseClearMemoryResult, parseMemoryStatus } from '../../src/shared/memory-ipc-validation';
it('rejects unknown fields, malformed IDs and invalid sequence', () => {
  const command = { streamId: 's', requestId: 'r', sequence: 1 };
  expect(parseClearMemoryCommand(command)).toEqual(command);
  for (const invalid of [{ ...command, sequence: Infinity }, { ...command, requestId: ' '.repeat(10) }, { ...command, extra: 1 }, { ...command, sequence: 1.5 }]) expect(() => parseClearMemoryCommand(invalid)).toThrow();
});
it('allows only neutral status and clear result codes', () => {
  expect(parseMemoryStatus({ mode: 'initializing' })).toEqual({ mode: 'initializing' });
  expect(parseClearMemoryResult({ requestId: 'r', status: 'failed', reason: 'stale' })).toEqual({ requestId: 'r', status: 'failed', reason: 'stale' });
  expect(() => parseMemoryStatus({ mode: 'volatile', reason: 'SQLITE /private/path' })).toThrow();
  expect(() => parseClearMemoryResult({ requestId: 'r', status: 'cleared', reason: 'io_error' })).toThrow();
});
