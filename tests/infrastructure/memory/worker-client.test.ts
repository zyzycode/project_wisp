import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryWorkerClient, type MemoryWorker } from '../../../src/infrastructure/memory/worker-client';
import { createMemoryAdapters } from '../../../src/infrastructure/memory/adapters';
import type { Command } from '../../../src/infrastructure/memory/protocol';

class FakeWorker extends EventEmitter implements MemoryWorker {
  readonly sent: Command[] = [];
  terminated = false;
  postMessage(value: Command): void { this.sent.push(value); }
  async terminate(): Promise<number> { this.terminated = true; this.emit('exit', 1); return 1; }
  ready(): void { this.emit('message', { id: 0, result: { ok: true, value: undefined } }); }
  ack(value: unknown = undefined): void { const c = this.sent.at(-1); this.emit('message', { id: c?.id, result: { ok: true, value } }); }
}
function fixture() {
  const worker = new FakeWorker();
  const client = new MemoryWorkerClient({ workerPath: '', filename: '', now: '', createWorker: () => worker });
  worker.ready(); return { client, worker };
}
afterEach(() => vi.useRealTimers());

describe('memory worker transport', () => {
  it('serializes writes and reserves reset/close admission when the queue is full', async () => {
    const { worker, client } = fixture();
    const requests = Array.from({ length: 101 }, () => client.request('removeFact', 'key', 0));
    expect(worker.sent).toHaveLength(1);
    expect(await client.request('removeFact', 'overflow', 0)).toEqual({ ok: false, code: 'busy' });
    const reset = client.request('clear', null, 1);
    const closed = client.close(1);
    for (let i = 0; i < 102; i++) worker.ack();
    expect(worker.sent.at(-1)?.operation).toBe('close');
    worker.ack(); worker.emit('exit', 0);
    expect((await Promise.all(requests)).every(r => r.ok)).toBe(true);
    expect((await reset).ok).toBe(true); await closed;
  });
  it('coalesces pending checkpoints and never reports replaced payload as committed', async () => {
    const { worker, client } = fixture();
    const first = client.request('removeFact', 'key', 0);
    const snapshot = { snapshotVersion: 1, state: {}, updatedAt: '2026-09-18T00:00:00.000Z' };
    const replaced = client.request('saveSnapshot', snapshot, 0);
    const latest = client.request('saveSnapshot', { ...snapshot, state: { marker: 'latest' } }, 0);
    expect(await replaced).toEqual({ ok: false, code: 'stale' });
    worker.ack(); expect(worker.sent.at(-1)?.payload).toEqual({ ...snapshot, state: { marker: 'latest' } });
    worker.ack(); expect((await latest).ok).toBe(true); await first;
    const close = client.close(0); worker.ack(); worker.emit('exit', 0); await close;
  });
  it('fails every pending operation on worker death without exposing the exception', async () => {
    const { worker, client } = fixture();
    const pending = [client.request('removeFact', 'a', 0), client.request('removeFact', 'b', 0)];
    worker.emit('error', new Error('/private/user.sqlite SELECT secret'));
    expect(await Promise.all(pending)).toEqual([{ ok: false, code: 'unavailable' }, { ok: false, code: 'unavailable' }]);
    expect(await client.request('listFacts', 1, 0)).toEqual({ ok: false, code: 'unavailable' }); await client.close(0);
  });
  it('times out startup and discards a late ready response', async () => {
    vi.useFakeTimers(); const worker = new FakeWorker();
    const client = new MemoryWorkerClient({ workerPath: '', filename: '', now: '', createWorker: () => worker });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await client.ready).toEqual({ ok: false, code: 'unavailable' });
    worker.ready(); expect(await client.request('listFacts', 1, 0)).toEqual({ ok: false, code: 'unavailable' }); await client.close(0);
  });
  it('early input permanently abandons startup for this run', async () => {
    const worker = new FakeWorker(); const client = new MemoryWorkerClient({ workerPath: '', filename: '', now: '', createWorker: () => worker });
    client.abandonStartup(); worker.ready(); expect(await client.ready).toEqual({ ok: false, code: 'unavailable' }); expect(worker.terminated).toBe(true); await client.close(0);
  });
  it('lost operation acknowledgment fails closed without claiming rollback or success', async () => {
    vi.useFakeTimers(); const { worker, client } = fixture(); const pending = client.request('clear', null, 1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ ok: false, code: 'unavailable' }); expect(worker.terminated).toBe(true); await client.close(1);
  });
  it('shutdown deadline settles lost acknowledgments and waits for exit', async () => {
    vi.useFakeTimers(); const { worker, client } = fixture(); const pending = client.request('removeFact', 'key', 0);
    const close = client.close(0); await vi.advanceTimersByTimeAsync(7000); await close;
    expect(worker.terminated).toBe(true); expect(await pending).toEqual({ ok: false, code: 'unavailable' });
  });
  it('validates requests and malformed response envelopes at the transport boundary', async () => {
    const { worker, client } = fixture();
    expect(await client.request('getRecent', 0, 0)).toEqual({ ok: false, code: 'invalid_data' });
    const pending = client.request('listFacts', 1, 0); worker.emit('message', { id: 999, result: { ok: true, value: [] } });
    expect(await pending).toEqual({ ok: false, code: 'unavailable' }); await client.close(0);
  });
  it('all five adapters operate against the real worker and native addon without blocking Main', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'wisp worker тест '));
    // Test-only native TS loader: exercise the real entry without a production build.
    const source = `const { registerHooks, stripTypeScriptTypes } = require('node:module');
      const { readFileSync } = require('node:fs');
      const { fileURLToPath } = require('node:url');
      registerHooks({
        resolve(specifier, context, next) { try { return next(specifier, context); } catch (error) { if (specifier.startsWith('.')) return next(specifier + '.ts', context); throw error; } },
        load(url, context, next) { if (!url.endsWith('.ts')) return next(url, context); return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }), shortCircuit: true }; }
      });
      import(${JSON.stringify(pathToFileURL(path.resolve('src/infrastructure/memory/worker.ts')).href)});`;
    const client = new MemoryWorkerClient({ workerPath: '', filename: '', now: '', createWorker: () => new Worker(source, { eval: true, workerData: { filename: path.join(directory, 'memory', 'wisp.sqlite3'), now: '2026-09-18T00:00:00.000Z' } }) });
    try {
      expect(await client.ready).toEqual({ ok: true, value: undefined });
      const repos = createMemoryAdapters(client), c = { generation: 0 };
      expect(await repos.history.getRecent(20, c)).toEqual({ ok: true, value: [] });
      expect(await repos.facts.list(20, c)).toEqual({ ok: true, value: [] });
      expect(await repos.character.load(c)).toEqual({ ok: true, value: null });
      const lock = new Database(path.join(directory, 'memory', 'wisp.sqlite3'));
      lock.exec('BEGIN IMMEDIATE');
      const write = repos.episodes.append({ appRunId: 'app', activityRunId: 'game', kind: 'cursor_game', outcome: 'missed', playCompleted: true, executedMs: 400, endedAt: '2026-09-18T00:00:00.000Z' }, c);
      let mainTicked = false;
      await new Promise<void>(resolve => setTimeout(() => { mainTicked = true; lock.exec('ROLLBACK'); lock.close(); resolve(); }, 50));
      expect(mainTicked).toBe(true);
      expect(await write).toEqual({ ok: true, value: undefined });
      expect(await repos.gameReader.getRecent(20, c)).toMatchObject({ ok: true, value: [{ activityRunId: 'game', outcome: 'missed', playCompleted: true }] });
      expect((await repos.clear.clearUserMemory({ generation: 1 })).ok).toBe(true);
      expect(await repos.facts.list(1, c)).toEqual({ ok: false, code: 'stale' });
    } finally { await client.close(1); rmSync(directory, { recursive: true, force: true }); }
  });
});
