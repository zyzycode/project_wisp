import { afterEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { MemoryResult } from '../../../src/application/ports/memory-repository.interface';
import type { ISummarySourceReader } from '../../../src/application/ports/summary';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import { summarySnapshot } from '../../../src/infrastructure/memory/summary-source-reader';
import { FileSummaryCache } from '../../../src/infrastructure/memory/summary-cache';
import { SummaryRuntime } from '../../../src/application/services/summary-runtime';
import { ExternalAIProviderClient } from '../../../src/infrastructure/ai/external-ai-provider-client';
import { providerRequest } from '../backend-ai-fixture';
import { backendIntegrationFixture } from '../backend-integration-fixture';
const folders: string[] = []; const date = '2026-10-17T00:00:00.000Z';
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
async function folder() { const value = await mkdtemp(path.join(os.tmpdir(), 'wisp-summary-')); folders.push(value); return value; }
it('generates explicitly, restarts, resolves exact sources after1000 pairs, and sends actual v1 prompt with coverage', async () => {
  const root = await folder(), filename = path.join(root, 'memory.sqlite'), cachefile = path.join(root, 'summary.json');
  let store = SqliteMemoryStore.open(filename, date), id = 0, generation = 0, session = 'session';
  function call(operation: string, payload: unknown): MemoryResult<unknown> { return store.execute({ id: ++id, operation, payload, generation }); }
  function append(n: number, eligible = true) {
    expect(call('appendTurn', { memoryConfirmable: eligible, session: { id: session, appRunId: session, startedAt: date, endedAt: null }, user: { id: `u${n}`, conversationSessionId: session, role: 'user', content: `Космос тема ${n}`, createdAt: date }, assistant: { id: `a${n}`, conversationSessionId: session, role: 'assistant', content: 'Обсудили космос', createdAt: date } }).ok).toBe(true);
  }
  const sources: ISummarySourceReader = { recent: async () => { const r = call('summaryRecent', null); return r.ok ? { ok: true, value: summarySnapshot(r.value) } : r; }, exact: async s => { const r = call('summaryExact', s); return r.ok ? { ok: true, value: summarySnapshot(r.value) } : r; } };
  const bridge = await backendIntegrationFixture();
  try {
  const generator = new ExternalAIProviderClient({ baseUrl: 'https://backend.invalid', development: false, now: Date.now, fetch: bridge.fetch });
  const options = () => ({ sources, cache: new FileSummaryCache(cachefile), generator, context: () => ({ generation }), now: Date.now, createId: randomUUID, hash: (s: string) => createHash('sha256').update(s).digest('hex'), scheduler: { setTimeout, clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) }, locale: 'ru' as const, beforeRead: async () => {}, canGenerate: () => true });
  for (let n = 0; n < 11; n++) append(n);
  const first = new SummaryRuntime(options()); const preview = await first.preview(); expect(preview.ok).toBe(true); if (!preview.ok) throw new Error('preview');
  expect(await first.confirm(randomUUID(), preview.value.previewId)).toMatchObject({ ok: true }); first.dispose(); store.close();
  store = SqliteMemoryStore.open(filename, date); session = 'new-session';
  // Reuse the persisted session directly only for the synthetic fixture; normal app creates a new session.
  for (let n = 11; n < 1011; n++) append(n);
  const restarted = new SummaryRuntime(options()); const capture = await restarted.capture('Космос'); expect(capture?.excludedMessageIds).toHaveLength(16);
  await generator.generateResponse({ ...providerRequest(), summary: { text: capture!.text } }); expect(bridge.requests.at(-1)?.body).toMatchObject({ summary: { text: 'Пользователь обсуждал космос.' } });
  expect(bridge.requests.filter(request => request.path === '/v1/summary')).toHaveLength(1);
  expect(bridge.responses.at(-1)?.upstreamMessages.some(message => message.content.includes('Unconfirmed older-dialogue summary:'))).toBe(true);
  generation++; expect(call('mutateMemoryItem', { kind: 'confirm', commandId: 'confirm', itemId: 'item', expectedRevision: 0, confirmed: true, content: { category: 'shared_joke', label: 'Космос', text: 'История', occurredOn: null }, source: { userMessageId: 'u0', assistantMessageId: 'a0' }, confirmedAt: date }).ok).toBe(true);
  expect(await restarted.capture('Космос')).toBeUndefined(); await restarted.reset(); generation++; expect(call('clear', null).ok).toBe(true); expect(await restarted.capture('Космос')).toBeUndefined(); restarted.dispose();
  } finally { store.close(); await bridge.close(); }
}, 20000);
it('bounded atomic cache fails closed for malformed/future files; explicit delete preserves a24h quarantine and full reset removes it', async () => {
  const filename = path.join(await folder(), 'summary.json'), cache = new FileSummaryCache(filename, () => 1234);
  for (const data of ['{broken', JSON.stringify({ formatVersion: 99 }), 'x'.repeat(32769)]) {
    await writeFile(filename, data); expect((await cache.read()).ok).toBe(false);
    expect((await cache.clear(false)).ok).toBe(true); const result = await cache.read(); expect(result).toMatchObject({ ok: true, value: { entry: null, receipt: { admittedAt: 1234 } } });
  }
  const generation = cache.invalidate(); const pending = cache.write({ formatVersion: 1, entry: null, receipt: null }, generation); cache.dispose(); expect(await pending).toEqual({ ok: false, code: 'stale' });
  const reset = new FileSummaryCache(filename); await reset.clear(true); expect(await readFile(filename).catch(() => null)).toBeNull();
});
it('durable provenance excludes schema1/migrated unknown/fallback pairs without deleting transcript', async () => {
  const store = SqliteMemoryStore.open(path.join(await folder(), 'old.sqlite'), date);
  for (let n = 0; n < 8; n++) expect(store.execute({ id: n + 1, generation: 0, operation: 'appendTurn', payload: { session: { id: 's', appRunId: 'r', startedAt: date, endedAt: null }, user: { id: `u${n}`, conversationSessionId: 's', role: 'user', content: 'Космос', createdAt: date }, assistant: { id: `a${n}`, conversationSessionId: 's', role: 'assistant', content: 'Ответ', createdAt: date } } }).ok).toBe(true);
  const raw = store.execute({ id: 20, generation: 0, operation: 'summaryRecent', payload: null }); if (!raw.ok) throw new Error(raw.code);
  expect(summarySnapshot(raw.value).pairs.every(pair => !pair.eligible)).toBe(true);
  expect(store.execute({ id: 21, generation: 0, operation: 'getRecent', payload: 100 })).toMatchObject({ ok: true, value: expect.arrayContaining([expect.objectContaining({ id: 'u0' })]) }); store.close();
});
it('reset barrier wins over a file writer paused after staging and cannot recreate the cache', async () => {
  const { open } = await import('node:fs/promises');
  const root = await folder(), probe = await open(path.join(root, 'probe'), 'w');
  const prototype: { sync(): Promise<void> } = Object.getPrototypeOf(probe);
  let release!: () => void; let entered = false;
  const sync = vi.spyOn(prototype, 'sync').mockImplementation(() => new Promise<void>(resolve => { entered = true; release = resolve; }));
  const filename = path.join(root, 'summary.json'), cache = new FileSummaryCache(filename);
  try {
    const pending = cache.write({ formatVersion: 1, entry: null, receipt: null }, cache.invalidate());
    await vi.waitFor(() => expect(entered).toBe(true));
    const reset = cache.clear(true); release();
    expect(await pending).toEqual({ ok: false, code: 'stale' }); expect((await reset).ok).toBe(true);
    expect(await readFile(filename).catch(() => null)).toBeNull(); expect(await readFile(`${filename}.tmp`).catch(() => null)).toBeNull();
  } finally { sync.mockRestore(); await probe.close(); }
});
it('automatic mutation cannot repair corrupt or future cache; only explicit deletion clears quarantine', async () => {
  const filename = path.join(await folder(), 'summary.json'), cache = new FileSummaryCache(filename);
  for (const original of ['{broken', '{"formatVersion":99}']) {
    await writeFile(filename, original);
    expect(await cache.clear(false, false)).toEqual({ ok: false, code: 'corrupt' });
    expect(await readFile(filename, 'utf8')).toBe(original);
    expect((await cache.clear(false, true)).ok).toBe(true);
    expect(await cache.read()).toMatchObject({ ok: true, value: { entry: null, receipt: { commandId: 'corrupt-cache-quarantine' } } });
  }
});
it('explicit corruption repair retains a valid receipt even when its clock is ahead', async () => {
  const filename = path.join(await folder(), 'summary.json');
  const receipt = { commandId: 'existing', requestId: 'existing', sourceDigest: 'a'.repeat(64), admittedAt: 200000000, generatorVersion: 1 };
  await writeFile(filename, JSON.stringify({ formatVersion: 99, entry: 'invalid', receipt }));
  const cache = new FileSummaryCache(filename, () => 1);
  expect((await cache.clear(false, true)).ok).toBe(true);
  expect(await cache.read()).toEqual({ ok: true, value: { formatVersion: 1, entry: null, receipt } });
});
