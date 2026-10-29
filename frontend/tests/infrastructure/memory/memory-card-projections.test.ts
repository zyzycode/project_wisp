import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import { MemoryWorkerClient, type MemoryWorker } from '../../../src/infrastructure/memory/worker-client';
import { createMemoryAdapters } from '../../../src/infrastructure/memory/adapters';
import { command } from '../../../src/infrastructure/memory/protocol';
import { MemoryHistory } from '../../../src/application/services/memory-history';
import { LocalMemoryRecall } from '../../../src/application/services/memory-recall';
import { DialogueRuntime } from '../../../src/application/services/dialogue-loop.service';
import { ExternalAIProviderClient } from '../../../src/infrastructure/ai/external-ai-provider-client';
import { providerRequest } from '../backend-ai-fixture';
const date = '2026-10-17T10:00:00.000Z';
const folders: string[] = [], clients: MemoryWorkerClient[] = [];
class Bridge extends EventEmitter implements MemoryWorker {
  constructor(private readonly store: SqliteMemoryStore) { super(); queueMicrotask(() => this.emit('message', { id: 0, result: { ok: true, value: undefined } })); }
  postMessage(value: unknown): void { const c = command(value); queueMicrotask(() => { this.emit('message', { id: c.id, result: this.store.execute(c) }); if (c.operation === 'close') this.emit('exit', 0); }); }
  async terminate(): Promise<number> { this.store.close(); this.emit('exit', 0); return 0; }
}
async function open() {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'wisp-card-projections-')); folders.push(folder);
  const filename = path.join(folder, 'memory.sqlite3');
  const client = new MemoryWorkerClient({ workerPath: '', filename, now: date, createWorker: () => new Bridge(SqliteMemoryStore.open(filename, date)) }); clients.push(client); await client.ready;
  const repos = createMemoryAdapters(client); let generation = 0;
  const history = new MemoryHistory({ ...repos, context: () => ({ generation }), createId: randomUUID, toTimestamp: () => date, onFailure: code => { throw new Error(code); } });
  const recall = new LocalMemoryRecall({ ...repos, beforeRead: () => history.whenSettled(), scheduler: { setTimeout, clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) }, isCurrent: g => g === generation, preference: () => undefined, onFailure: vi.fn() });
  return { repos, history, recall, generation: () => generation, next: () => ++generation };
}
afterEach(async () => { for (const client of clients.splice(0)) await client.close(99); for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
it('omits suppressed pairs from hydration, recall and unified network projection after every mutation', async () => {
  const f = await open(); const bodies: unknown[] = [];
  const provider = new ExternalAIProviderClient({ baseUrl: 'https://fake.invalid', development: false, now: Date.now,
    fetch: async (_url, init) => {
      const body: unknown = JSON.parse(String(init?.body)); bodies.push(body);
      if (!body || typeof body !== 'object' || !('requestId' in body)) throw new Error('missing request');
      return new Response(JSON.stringify({ appraisal: { category: 'neutral', intensity: 'low', confidence: 'clear' }, requestId: body.requestId, text: 'Северное сияние — незабываемая встреча' }), { headers: { 'content-type': 'application/json' } });
    } });
  const runtime = new DialogueRuntime({ getSemanticSleepState: () => 'awake', interactionEnabled: true, provider, memory: { generation: f.generation, recall: f.recall, completed: turn => { void f.history.completed(turn); } },
    now: Date.now, timestamp: () => date, createId: randomUUID, scheduler: { setTimeout, clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) },
    getCharacterSnapshot: () => providerRequest().characterSnapshot, applyStimulus: vi.fn(), beginThinking: vi.fn(), endThinking: vi.fn(), transaction: work => work(), publish: vi.fn(), offerIntent: vi.fn() });
  runtime.replaceStream('stream'); let sequence = 0;
  const send = async (text: string) => {
    const receipt = runtime.receive({ type: 'send', streamId: 'stream', conversationId: runtime.getPresentation().conversationId, sequence: ++sequence, text });
    expect(receipt.status).toBe('accepted'); await vi.waitFor(() => expect(runtime.getPresentation().turn.phase).toBe('completed')); await f.history.whenSettled();
  };
  try {
    await send('Мы увидели северное сияние');
    const presentation = runtime.getPresentation().turn;
    if (presentation.phase !== 'completed' || !presentation.memorySource) throw new Error('No confirmed source');
    const source = presentation.memorySource;
    const create = { kind: 'confirm' as const, commandId: 'confirm', itemId: 'card', expectedRevision: 0 as const, confirmed: true as const, source,
      content: { category: 'important_event' as const, label: 'Наше событие', text: 'Подтверждённая карточка', occurredOn: null }, confirmedAt: date };
    expect(await f.repos.items.confirm(create, { generation: f.next() })).toMatchObject({ ok: true }); runtime.clearMemoryContext();
    expect(await f.history.hydrate()).toEqual([]);
    expect(await f.recall.recall({ text: 'северное сияние', excludedMessageIds: [] }, { generation: f.generation() })).toMatchObject({ ok: true, value: { episodes: [] } });
    await send('северное');
    const afterConfirm = JSON.stringify(bodies.at(-1));
    expect(afterConfirm).not.toContain('Мы увидели северное сияние'); expect(afterConfirm).not.toContain('незабываемая встреча'); expect(afterConfirm).not.toContain('Подтверждённая карточка');
    for (const kind of ['update', 'withdraw', 'delete'] as const) {
      const generation = f.next(); const revision = kind === 'update' ? 1 : kind === 'withdraw' ? 2 : 3;
      const result = kind === 'update' ? await f.repos.items.update({ ...create, kind, commandId: kind, expectedRevision: revision, content: { ...create.content, text: 'Исправленная карточка' } }, { generation })
        : kind === 'withdraw' ? await f.repos.items.withdraw({ kind, commandId: kind, itemId: 'card', expectedRevision: revision }, { generation })
        : await f.repos.items.delete({ kind, commandId: kind, itemId: 'card', expectedRevision: revision }, { generation });
      expect(result.ok).toBe(true); runtime.clearMemoryContext();
      // Every later turn is a different source ID; the original pair stays suppressed.
      await send('сияние');
      expect(JSON.stringify(bodies.at(-1))).not.toContain('Мы увидели северное сияние');
      expect(JSON.stringify(bodies.at(-1))).not.toContain('Исправленная карточка');
      const persisted = await f.repos.history.getRecent(100, { generation });
      expect(persisted.ok && persisted.value.some(message => message.id === source.userMessageId || message.id === source.assistantMessageId)).toBe(false);
    }
  } finally { runtime.dispose(); }
});
it('aborts an in-flight chat on mutation and never republishes or persists its late provider result', async () => {
  let resolve!: (value: Response) => void; let signal: AbortSignal | null | undefined;
  const fetcher: typeof fetch = async (_url, init) => { signal = init?.signal; return new Promise(yes => { resolve = yes; }); };
  const provider = new ExternalAIProviderClient({ baseUrl: 'https://fake.invalid', development: false, now: Date.now, fetch: fetcher });
  const completed = vi.fn(); let generation = 0;
  const runtime = new DialogueRuntime({ getSemanticSleepState: () => 'awake', interactionEnabled: true, provider, memory: { generation: () => generation, completed }, now: Date.now, timestamp: () => date, createId: randomUUID,
    scheduler: { setTimeout, clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) }, getCharacterSnapshot: () => providerRequest().characterSnapshot,
    applyStimulus: vi.fn(), beginThinking: vi.fn(), endThinking: vi.fn(), transaction: work => work(), publish: vi.fn(), offerIntent: vi.fn() });
  runtime.replaceStream('s'); runtime.receive({ type: 'send', sequence: 1, streamId: 's', conversationId: runtime.getPresentation().conversationId, text: 'old request' });
  await vi.waitFor(() => expect(signal).toBeDefined()); generation++; runtime.clearMemoryContext(); expect(signal?.aborted).toBe(true);
  resolve(new Response(JSON.stringify({ requestId: 'old', text: 'late secret', appraisal: { category: 'neutral', intensity: 'low', confidence: 'clear' } }), { headers: { 'content-type': 'application/json' } }));
  await vi.waitFor(() => expect(runtime.getPresentation().canSubmit).toBe(true));
  expect(runtime.getPresentation().turn.phase).toBe('idle'); expect(completed).not.toHaveBeenCalled(); runtime.dispose();
});
