import { expect, it, vi } from 'vitest';
import type { ClearMemoryCommandDTO, ClearMemoryResultDTO, MemoryFactsResultDTO, MemoryStatusDTO } from '../../src/shared/ipc-contracts';
import { MemoryOverviewClient } from '../../src/renderer/memory-overview-client';
function fixture() {
  const bridge = {
    getMemoryStatus: vi.fn(async (): Promise<MemoryStatusDTO> => ({ mode: 'persistent', characterRestore: 'default' })),
    readMemoryFacts: vi.fn(async (): Promise<MemoryFactsResultDTO> => ({ ok: true, facts: [{ key: 'user.display_name', value: 'Анна' }] })),
    clearMemory: vi.fn(async (command: ClearMemoryCommandDTO): Promise<ClearMemoryResultDTO> => ({ requestId: command.requestId, status: 'cleared' })),
  };
  let id = 0;
  const client = new MemoryOverviewClient(bridge, () => `request-${++id}`);
  client.acceptIdentity('stream', 'conversation');
  return { client, bridge };
}
it('requires explicit loaded confirmation and coalesces double reset without hiding old facts', async () => {
  const { client, bridge } = fixture();
  expect(await client.clear()).toBe(false);
  await client.read(); expect(client.getState().facts).toHaveLength(1);
  client.openConfirmation(); client.cancelConfirmation(); expect(await client.clear()).toBe(false);
  client.openConfirmation();
  let finish!: (value: ClearMemoryResultDTO) => void;
  bridge.clearMemory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const clearing = client.clear(); expect(await client.clear()).toBe(false);
  expect(client.getState().facts).toHaveLength(1);
  finish({ requestId: bridge.clearMemory.mock.calls[0]![0].requestId, status: 'cleared' });
  expect(await clearing).toBe(true); expect(bridge.clearMemory).toHaveBeenCalledTimes(1);
});
it('retries the same identity after lost or uncorrelated acknowledgement', async () => {
  const { client, bridge } = fixture(); await client.read(); client.openConfirmation();
  bridge.clearMemory.mockRejectedValueOnce(new Error('private'));
  expect(await client.clear()).toBe(false); expect(client.getState().uncertain).toBe(true);
  expect(await client.clear()).toBe(false);
  bridge.clearMemory.mockResolvedValueOnce({ requestId: 'other', status: 'cleared' });
  expect(await client.retry()).toBe(false); expect(client.getState().message).not.toContain('private');
  expect(await client.retry()).toBe(true);
  expect(bridge.clearMemory.mock.calls.map(call => call[0])).toEqual(Array(3).fill(bridge.clearMemory.mock.calls[0]![0]));
});
it('does not expose empty facts on failures or volatile storage and does not clear durable data there', async () => {
  const { client, bridge } = fixture();
  bridge.readMemoryFacts.mockRejectedValueOnce(new Error('private'));
  await client.read(); expect(client.getState().facts).toBeNull();
  bridge.getMemoryStatus.mockResolvedValue({ mode: 'volatile', reason: 'io_error' });
  await client.read(); client.openConfirmation(); expect(await client.clear()).toBe(false);
  expect(client.getState().facts).toBeNull(); expect(bridge.clearMemory).not.toHaveBeenCalled();
});
it('ignores late old reads and reset results after stream replacement', async () => {
  const { client, bridge } = fixture();
  let read!: (value: MemoryFactsResultDTO) => void;
  bridge.readMemoryFacts.mockImplementationOnce(() => new Promise(resolve => { read = resolve; }));
  const loading = client.read(); client.acceptIdentity('next', 'new');
  read({ ok: true, facts: [{ key: 'user.display_name', value: 'Старое' }] }); await loading;
  expect(client.getState().facts).toBeNull();
  await client.read(); client.openConfirmation();
  let clear!: (value: ClearMemoryResultDTO) => void;
  bridge.clearMemory.mockImplementationOnce(() => new Promise(resolve => { clear = resolve; }));
  const clearing = client.clear(); const command = bridge.clearMemory.mock.calls[0]![0];
  client.acceptIdentity('third', 'newer'); clear({ requestId: command.requestId, status: 'cleared' });
  expect(await clearing).toBe(false); expect(client.getState().message).toBeNull();
});
it('invalidates facts/forms on conversation replacement but retains current-stream reset identity', async () => {
  const { client, bridge } = fixture(); await client.read(); client.openConfirmation();
  client.acceptIdentity('stream', 'next'); expect(client.getState().confirming).toBe(false); expect(client.getState().facts).toBeNull();
  await client.read(); client.openConfirmation(); bridge.clearMemory.mockRejectedValueOnce(new Error());
  await client.clear(); const command = bridge.clearMemory.mock.calls[0]![0];
  client.acceptIdentity('stream', 'reset'); expect(client.getState().uncertain).toBe(true);
  await client.retry(); expect(bridge.clearMemory.mock.calls[1]![0]).toBe(command);
});
it('rollback keeps existing facts and stale failure never claims deletion', async () => {
  const { client, bridge } = fixture(); await client.read(); client.openConfirmation();
  bridge.clearMemory.mockImplementationOnce(async c => ({ requestId: c.requestId, status: 'failed', reason: 'io_error' }));
  expect(await client.clear()).toBe(false); expect(client.getState().facts).toHaveLength(1);
  expect(client.getState().message).not.toContain('очищена'); expect(client.getState().uncertain).toBe(false);
});
it('bounds hung reads and turns acknowledgement timeout into same-command retry, never success', async () => {
  vi.useFakeTimers();
  try {
    const { client, bridge } = fixture();
    bridge.readMemoryFacts.mockImplementationOnce(() => new Promise(() => {}));
    const reading = client.read(); await vi.advanceTimersByTimeAsync(10_000); await reading;
    expect(client.getState().loading).toBe(false); expect(client.getState().facts).toBeNull();
    await client.read(); expect(client.getState().message).toBeNull(); client.openConfirmation();
    let finish!: (value: ClearMemoryResultDTO) => void;
    bridge.clearMemory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const clearing = client.clear(); const command = bridge.clearMemory.mock.calls[0]![0];
    await vi.advanceTimersByTimeAsync(10_000); expect(await clearing).toBe(false);
    expect(client.getState().uncertain).toBe(true); expect(client.getState().cleared).toBe(0);
    finish({ requestId: command.requestId, status: 'cleared' }); await Promise.resolve();
    expect(client.getState().cleared).toBe(0);
    expect(await client.retry()).toBe(true); expect(bridge.clearMemory.mock.calls[1]![0]).toBe(command);
  } finally { vi.useRealTimers(); }
});
it('keeps an accepted command across collapsed presentation and consumes its reset refresh only once across remounts', async () => {
  const { client, bridge } = fixture(); await client.read(); client.openConfirmation();
  let finish!: (value: ClearMemoryResultDTO) => void;
  bridge.clearMemory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const clearing = client.clear(); const command = bridge.clearMemory.mock.calls[0]![0];
  client.cancelConfirmation(); expect(client.getState().busy).toBe(true);
  client.acceptIdentity('stream', 'conversation'); // Reopening the same document preserves the accepted command.
  expect(await client.clear()).toBe(false);
  finish({ requestId: command.requestId, status: 'cleared' }); expect(await clearing).toBe(true);
  expect(client.consumeClearRefresh()).toBe(true);
  client.acceptIdentity('stream', 'conversation'); expect(client.consumeClearRefresh()).toBe(false);
  client.openConfirmation(); bridge.clearMemory.mockRejectedValueOnce(new Error()); await client.clear();
  expect(client.consumeClearRefresh()).toBe(false); expect(client.getState().uncertain).toBe(true);
});
