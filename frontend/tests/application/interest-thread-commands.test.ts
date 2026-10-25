import { expect, it, vi } from 'vitest';
import { InterestThreadCommands } from '../../src/application/services/interest-thread-commands';
import type { MemoryLifecycle } from '../../src/application/services/memory-lifecycle';
import type { InterestThreadCommandDTO } from '../../src/shared/ipc-contracts';
import { isInterestThreadSourceText } from '../../src/application/services/memory-fact-registry';
const now = '2026-10-22T00:00:00.000Z';
const command: Extract<InterestThreadCommandDTO, { kind: 'confirm' }> = { kind: 'confirm', streamId: 's', sequence: 1, generation: 0, commandId: 'cmd', threadId: 'topic', expected: null, conversationId: 'c', source: { userMessageId: 'u', assistantMessageId: 'a' }, text: 'собеседование', confirmed: true };
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; }
function fixture() {
  let generation = 0;
  const settled = deferred<void>();
  const mutateInterestThread = vi.fn<MemoryLifecycle['mutateInterestThread']>(async c => { generation++; return { ok: true, value: { commandId: c.commandId, ref: { threadId: 'topic', revision: 1 }, outcome: 'unanswered' } }; });
  const readInterestThread = vi.fn<MemoryLifecycle['readInterestThread']>(async () => ({ ok: true, value: { thread: null, sourceValid: false } }));
  const runtime = { currentGeneration: () => generation, isRunning: () => true, history: { whenSettled: () => settled.promise }, mutateInterestThread, readInterestThread };
  const sourceText = vi.fn(() => 'сегодня собеседование');
  const commands = new InterestThreadCommands({ runtime: () => runtime, sourceText, timestamp: () => now, createId: () => 'id', bounded: work => work }); commands.replaceStream('s');
  return { commands, settled, mutateInterestThread, readInterestThread, sourceText, bump: () => { generation++; } };
}
it('waits for committed history before source recheck and generation barrier; identical replay coalesces', async () => {
  const f = fixture(); const result = f.commands.mutate(command);
  expect(f.mutateInterestThread).not.toHaveBeenCalled(); expect(f.commands.mutate(command)).toBe(result);
  f.settled.resolve(); expect(await result).toMatchObject({ ok: true, generation: 1 }); expect(f.sourceText).toHaveBeenCalledWith(command); expect(f.mutateInterestThread).toHaveBeenCalledTimes(1);
  expect(await f.commands.mutate({ ...command, text: 'other' })).toMatchObject({ ok: false, code: 'conflict' });
});
it.each(['stream', 'generation', 'source'])('revalidates %s after source commit settles', async action => {
  const f = fixture(), result = f.commands.mutate(command);
  if (action === 'stream') f.commands.replaceStream('new'); if (action === 'generation') f.bump(); if (action === 'source') f.sourceText.mockReturnValue('different source');
  f.settled.resolve(); expect(await result).toMatchObject({ ok: false }); expect(f.mutateInterestThread).not.toHaveBeenCalled();
});
it.each(['Меня зовут Ира', 'Мне нравятся твои прогулки', 'Забудь всё', 'Временно играем в доктора', 'На время считай меня королём', 'Представь себя драконом', 'Forget this', 'Pretend you are a doctor'])('rejects learned and command-prefixed source %s', async text => {
  expect(isInterestThreadSourceText(text)).toBe(false);
  const f = fixture(); f.sourceText.mockReturnValue(text); f.settled.resolve(); expect(await f.commands.mutate({ ...command, text: text.slice(0, 4) })).toMatchObject({ ok: false, code: 'invalid_data' }); expect(f.mutateInterestThread).not.toHaveBeenCalled();
});
it('stale UI read cannot maintain expired topic and reset a newly opened chat', async () => {
  const f = fixture(), pending = deferred<Awaited<ReturnType<MemoryLifecycle['readInterestThread']>>>(); f.readInterestThread.mockReturnValue(pending.promise);
  const result = f.commands.read({ streamId: 's' }); f.commands.replaceStream('new');
  pending.resolve({ ok: true, value: { thread: { ref: { threadId: 'topic', revision: 1 }, state: 'unanswered', text: 'quote', source: command.source, statedAt: now, confirmedAt: now, eligibleAt: now, expiresAt: now, attempt: null }, sourceValid: true } });
  expect(await result).toMatchObject({ ok: false, code: 'stale' }); expect(f.mutateInterestThread).not.toHaveBeenCalled();
});
