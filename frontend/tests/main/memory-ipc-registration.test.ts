import { expect, it, vi } from 'vitest';
import { registerMemoryIpc } from '../../src/main/memory-ipc-registration';
import { ClearMemoryUseCase } from '../../src/application/services/clear-memory.use-case';
import type { MemoryHistoryResultDTO } from '../../src/shared/ipc-contracts';
function fixture() {
  const handlers = new Map<string, (event: { sender: object }, ...args: unknown[]) => Promise<unknown>>(); const sender = {};
  const reset = vi.fn(async () => ({ ok: true, value: undefined } as const)); const clear = new ClearMemoryUseCase(reset); clear.replaceStream('stream');
  const remove = vi.fn(); const unregister = registerMemoryIpc({ register: (channel, handler) => handlers.set(channel, handler), remove, getSender: () => sender, getStatus: () => ({ mode: 'persistent', characterRestore: 'restored' }), clear });
  return { handlers, sender, reset, remove, unregister };
}
it('checks sender and exact shape before invoking reset', async () => {
  const f = fixture(), clear = f.handlers.get('wisp:clear-memory')!, c = { streamId: 'stream', requestId: 'request', sequence: 1 };
  await expect(clear({ sender: {} }, c)).rejects.toThrow('Untrusted');
  await expect(clear({ sender: f.sender }, { ...c, extra: true })).rejects.toThrow();
  await expect(clear({ sender: f.sender }, { ...c, sequence: 0 })).rejects.toThrow();
  expect(f.reset).not.toHaveBeenCalled(); expect(await clear({ sender: f.sender }, c)).toEqual({ requestId: 'request', status: 'cleared' });
});
it('accepts no arguments for status and releases both handlers', async () => {
  const f = fixture(), status = f.handlers.get('wisp:get-memory-status')!;
  await expect(status({ sender: f.sender }, undefined)).rejects.toThrow();
  expect(await status({ sender: f.sender })).toEqual({ mode: 'persistent', characterRestore: 'restored' });
  f.unregister(); expect(f.remove.mock.calls).toEqual([['wisp:get-memory-status'], ['wisp:clear-memory']]);
});
it('validates card sender, arguments, inputs and results and removes optional handlers', async () => {
  const f = fixture(); const mutate = vi.fn(async () => ({ ok: false, generation: 0, code: 'unavailable' } as const));
  const list = vi.fn(async () => ({ ok: true, generation: 0, items: [], nextCursor: null } as const));
  const unregister = registerMemoryIpc({ register: (channel, handler) => f.handlers.set(channel, handler), remove: f.remove,
    getSender: () => f.sender, getStatus: () => ({ mode: 'persistent', characterRestore: 'restored' }),
    clear: new ClearMemoryUseCase(f.reset), cards: { mutate, list } });
  const mutation = f.handlers.get('wisp:mutate-memory-card')!, listing = f.handlers.get('wisp:list-memory-cards')!;
  const command = { streamId: 'stream', sequence: 1, commandId: 'cmd', generation: 0, itemId: 'item', expectedRevision: 1, kind: 'delete' };
  await expect(mutation({ sender: {} }, command)).rejects.toThrow('Untrusted');
  await expect(mutation({ sender: f.sender }, { ...command, secret: true })).rejects.toThrow();
  expect(mutate).not.toHaveBeenCalled(); expect(await mutation({ sender: f.sender }, command)).toMatchObject({ ok: false, code: 'unavailable' });
  await expect(listing({ sender: f.sender }, { streamId: 'stream', cursor: null, limit: 21 })).rejects.toThrow();
  await expect(listing({ sender: f.sender })).rejects.toThrow(); expect(list).not.toHaveBeenCalled();
  expect(await listing({ sender: f.sender }, { streamId: 'stream', cursor: null, limit: 20 })).toMatchObject({ ok: true, items: [] });
  unregister(); expect(f.remove).toHaveBeenCalledWith('wisp:mutate-memory-card'); expect(f.remove).toHaveBeenCalledWith('wisp:list-memory-cards');
});
it('checks sender, exact topic input and parsed output before exposing local commands', async () => {
  const f = fixture(); const read = vi.fn(async () => ({ ok: true as const, generation: 0, value: null }));
  const mutate = vi.fn(async () => ({ ok: false as const, generation: 0, code: 'unavailable' as const }));
  const unregister = registerMemoryIpc({ register: (channel, handler) => f.handlers.set(channel, handler), remove: f.remove, getSender: () => f.sender, getStatus: () => ({ mode: 'persistent', characterRestore: 'restored' }), clear: new ClearMemoryUseCase(f.reset), interestThread: { read, mutate } });
  const reading = f.handlers.get('wisp:read-interest-thread')!, mutating = f.handlers.get('wisp:mutate-interest-thread')!;
  await expect(reading({ sender: {} }, { streamId: 'stream' })).rejects.toThrow('Untrusted');
  await expect(mutating({ sender: f.sender }, { kind: 'confirm', confirmed: false })).rejects.toThrow(); expect(mutate).not.toHaveBeenCalled();
  expect(await reading({ sender: f.sender }, { streamId: 'stream' })).toEqual({ ok: true, generation: 0, value: null });
  unregister(); expect(f.remove).toHaveBeenCalledWith('wisp:read-interest-thread'); expect(f.remove).toHaveBeenCalledWith('wisp:mutate-interest-thread');
});
it('exposes only trusted, exact readonly facts commands and validates private output', async () => {
  const f = fixture(), read = vi.fn(async () => ({ ok: true as const, facts: [] }));
  const unregister = registerMemoryIpc({ register: (channel, handler) => f.handlers.set(channel, handler), remove: f.remove, getSender: () => f.sender, getStatus: () => ({ mode: 'initializing' }), clear: new ClearMemoryUseCase(f.reset), facts: { read } });
  const handler = f.handlers.get('wisp:read-memory-facts')!;
  await expect(handler({ sender: {} }, { streamId: 's' })).rejects.toThrow('Untrusted');
  await expect(handler({ sender: f.sender }, { streamId: 's', source: 'private' })).rejects.toThrow();
  await expect(handler({ sender: f.sender }, { streamId: 's' }, null)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled(); expect(await handler({ sender: f.sender }, { streamId: 's' })).toEqual({ ok: true, facts: [] });
  unregister(); expect(f.remove).toHaveBeenCalledWith('wisp:read-memory-facts');
});
it('validates sender, command and output for saved dialogue readback', async () => {
  const f = fixture();
  const pair = { userText: 'иди влево', assistantText: 'Иду влево.' };
  const read = vi.fn(async (): Promise<MemoryHistoryResultDTO> => ({ ok: true, pairs: [pair] }));
  const unregister = registerMemoryIpc({
    register: (channel, handler) => f.handlers.set(channel, handler),
    remove: f.remove,
    getSender: () => f.sender,
    getStatus: () => ({ mode: 'initializing' }),
    clear: new ClearMemoryUseCase(f.reset),
    dialogueHistory: { read },
  });
  const handler = f.handlers.get('wisp:read-memory-history')!;
  const event = { sender: f.sender }, command = { streamId: 's' };
  await expect(handler({ sender: {} }, command)).rejects.toThrow('Untrusted');
  await expect(handler(event, { ...command, limit: 10 })).rejects.toThrow();
  await expect(handler(event, command, null)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(await handler(event, command)).toEqual({ ok: true, pairs: [pair] });

  const privatePair = { ...pair, id: 'private' };
  read.mockResolvedValueOnce({ ok: true, pairs: [privatePair] });
  await expect(handler(event, command)).rejects.toThrow();
  read.mockResolvedValueOnce({ ok: true, pairs: [{ ...pair, assistantText: 'a'.repeat(2001) }] });
  await expect(handler(event, command)).rejects.toThrow();
  unregister();
  expect(f.remove).toHaveBeenCalledWith('wisp:read-memory-history');
});
it('keeps routine opt-in commands behind sender/exact-shape validation and releases their handlers', async () => {
  const f=fixture(), read=vi.fn(async()=>({ok:false as const,code:'unavailable' as const}));
  const command=vi.fn(async(c: {readonly requestId:string})=>({ok:true as const,requestId:c.requestId}));
  const dispose=registerMemoryIpc({register:(name,handler)=>f.handlers.set(name,handler),remove:f.remove,getSender:()=>f.sender,getStatus:()=>({mode:'initializing'}),clear:new ClearMemoryUseCase(f.reset),routineHypothesis:{read,command}});
  const execute=f.handlers.get('wisp:command-routine-hypothesis')!, c={streamId:'s',requestId:'r',sequence:1,kind:'sharing',enabled:true};
  await expect(execute({sender:{}},c)).rejects.toThrow('Untrusted'); await expect(execute({sender:f.sender},{...c,consent:true})).rejects.toThrow(); expect(command).not.toHaveBeenCalled();
  expect(await execute({sender:f.sender},c)).toEqual({ok:true,requestId:'r'}); dispose(); expect(f.remove).toHaveBeenCalledWith('wisp:command-routine-hypothesis'); expect(f.remove).toHaveBeenCalledWith('wisp:read-routine-hypothesis');
});
