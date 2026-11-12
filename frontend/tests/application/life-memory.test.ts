import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MemoryWorkerClient } from '../../src/infrastructure/memory/worker-client';
import { createMemoryAdapters } from '../../src/infrastructure/memory/adapters';
import { LocalMemoryRecall, memoryTextLength } from '../../src/application/services/memory-recall';
import type { CompletedChatTurn } from '../../src/application/ports/memory-repository.interface';
import type { CausalLifeEpisode } from '../../src/application/ports/causal-life.interface';

declare module 'vitest' {
  interface TaskMeta { lifeMemory?: Readonly<Record<string, unknown>> }
}

const epoch = Date.parse('2026-09-01T00:00:00.000Z');
const timestamp = (minutes: number) => new Date(epoch + minutes * 60_000).toISOString();
function start(filename: string) {
  // Same native TS loader as memory-restart; no production build or mock SQL engine.
  const source = `const { registerHooks, stripTypeScriptTypes } = require('node:module');
    const { readFileSync } = require('node:fs'); const { fileURLToPath } = require('node:url');
    registerHooks({ resolve(specifier, context, next) { try { return next(specifier, context); } catch (error) { if (specifier.startsWith('.')) return next(specifier + '.ts', context); throw error; } },
      load(url, context, next) { return url.endsWith('.ts') ? { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }), shortCircuit: true } : next(url, context); } });
    import(${JSON.stringify(pathToFileURL(path.resolve('src/infrastructure/memory/worker.ts')).href)});`;
  const worker = new Worker(source, { eval: true, workerData: { filename, now: timestamp(0) } });
  const client = new MemoryWorkerClient({ workerPath: '', filename, now: timestamp(0), createWorker: () => worker });
  return { worker, client, repos: createMemoryAdapters(client) };
}
function turn(index: number): CompletedChatTurn {
  const sessionId = 'synthetic-session';
  const createdAt = timestamp(index * 10);
  return {
    session: { id: sessionId, appRunId: 'synthetic-run', startedAt: timestamp(0), endedAt: null },
    user: { id: `user-${index}`, conversationSessionId: sessionId, role: 'user', content: `Synthetic garden walk ${index}`, createdAt },
    assistant: { id: `assistant-${index}`, conversationSessionId: sessionId, role: 'assistant', content: 'Synthetic garden response', createdAt },
  };
}

it('keeps seven simulated days of native memory reads bounded across crash, restart and reset', async ({ task }) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wisp-life-memory-'));
  const filename = path.join(directory, 'memory.sqlite3');
  const dbBytes = () => readdirSync(directory).reduce((total, file) => total + statSync(path.join(directory, file)).size, 0);
  const started = performance.now(), cpu = process.cpuUsage();
  let run = start(filename);
  const context = { generation: 0 };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const recallLatencies: number[] = [];
  const samples: { day: number; bytes: number; rss: number; heapUsed: number }[] = [];
  let recallTimestamp = timestamp(0);
  try {
    expect(await run.client.ready).toEqual({ ok: true, value: undefined });
    const sample = (day: number) => { const memory = process.memoryUsage(); samples.push({ day, bytes: dbBytes(), rss: memory.rss, heapUsed: memory.heapUsed }); };
    sample(0);
    const recall = new LocalMemoryRecall({ ...run.repos, timestamp: () => recallTimestamp, isCurrent: generation => generation === 0, preference: () => undefined,
      scheduler: {
        setTimeout: (callback, delay) => { const handle = setTimeout(callback, delay); timers.add(handle); return handle; },
        clearTimeout: handle => { const timer = handle as ReturnType<typeof setTimeout>; clearTimeout(timer); timers.delete(timer); },
      }, onFailure: code => { throw new Error(`Unexpected recall failure: ${code}`); } });
    for (let day = 0; day < 7; day++) {
      for (let slot = 0; slot < 144; slot++) {
        const index = day * 144 + slot, draft = turn(index);
        expect(await run.repos.history.appendTurn(draft, context)).toEqual({ ok: true, value: undefined });
        // Replayed durable identity must not append a second pair.
        expect(await run.repos.history.appendTurn(draft, context)).toEqual({ ok: true, value: undefined });
        const episode = { appRunId: 'synthetic-run', activityRunId: `game-${index}`, kind: 'cursor_game' as const,
          outcome: 'caught' as const, playCompleted: true as const, executedMs: 1000, endedAt: timestamp(index * 10) };
        expect(await run.repos.episodes.append(episode, context)).toEqual({ ok: true, value: undefined });
        expect(await run.repos.episodes.append(episode, context)).toEqual({ ok: true, value: undefined });
        const causal: CausalLifeEpisode = { appRunId: 'synthetic-run', sequence: index * 2 + 1, revision: 1,
          occurredAt: episode.endedAt, activity: 'cursor_game', activityRunId: episode.activityRunId,
          outcome: 'completed', cause: 'completed', terminalReason: null, source: 'autonomy',
          participation: 'user_engaged', triggerSequence: null, executedMs: 1000 };
        const book: CausalLifeEpisode = { ...causal, sequence: index * 2 + 2, activity: 'book',
          activityRunId: `book-${index}`, participation: 'solitary', executedMs: 14000 };
        for (const event of [causal, book]) {
          expect(await run.repos.causalLife.append(event, context)).toEqual({ ok: true, value: undefined });
          expect(await run.repos.causalLife.append(event, context)).toEqual({ ok: true, value: undefined });
        }
      }
      recallTimestamp = timestamp((day + 1) * 1440);
      for (let repeat = 0; repeat < 10; repeat++) {
        const before = performance.now();
        const recalled = await recall.recall({ text: 'garden game', excludedMessageIds: [] }, context);
        recallLatencies.push(performance.now() - before);
        expect(recalled.ok).toBe(true);
        if (recalled.ok) {
          expect(recalled.value.episodes.length).toBeLessThanOrEqual(2);
          expect(memoryTextLength(recalled.value)).toBeLessThanOrEqual(2400);
          expect(recalled.value.episodes.some(event => event.kind === 'causal_event' && event.activity === 'cursor_game')).toBe(true);
        }
        expect(timers.size).toBe(0);
      }
      const recent = await run.repos.history.getRecent(100, context);
      expect(recent.ok && recent.value.length).toBe(100);
      const games = await run.repos.gameReader.getRecent(20, context);
      expect(games.ok && games.value.length).toBe(20);
      const causal = await run.repos.causalLife.getRecent(100, context);
      expect(causal.ok && causal.value.length).toBe(100);
      const window = await run.repos.lifeHistory.readWindow({ fromDateUTC: '2026-09-01',
        throughDateUTC: recallTimestamp.slice(0, 10), asOf: recallTimestamp }, context);
      expect(window.ok).toBe(true);
      if (window.ok) {
        expect(window.value.events.length).toBeLessThanOrEqual(1000);
        expect(window.value.examined).toBeLessThanOrEqual(1001);
        expect(window.value.coverage).toBe((day + 1) * 288 > 1000 ? 'overflow' : 'complete');
        if (window.value.coverage === 'overflow') expect(window.value.events).toEqual([]);
      }
      sample(day + 1);
    }
    // Kill with reads pending; every promise settles, future requests fail closed.
    const reads = Array.from({ length: 1000 }, () => run.repos.history.getRecent(100, context));
    await run.worker.terminate();
    const settled = await Promise.all(reads);
    expect(settled.filter(result => !result.ok && result.code === 'busy')).toHaveLength(899);
    expect(run.worker.threadId).toBe(-1);
    expect(await run.repos.history.getRecent(100, context)).toEqual({ ok: false, code: 'unavailable' });
    await run.client.close(0);
    const db = new Database(filename, { readonly: true });
    try {
      expect(db.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 2016 });
      expect(db.prepare('SELECT count(*) AS n FROM game_episodes').get()).toEqual({ n: 1008 });
      expect(db.prepare('SELECT count(*) AS n FROM causal_life_episodes').get()).toEqual({ n: 2016 });
      expect(db.prepare('SELECT count(*) AS n FROM conversation_sessions').get()).toEqual({ n: 1 });
    } finally { db.close(); }
    run = start(filename);
    expect(await run.client.ready).toEqual({ ok: true, value: undefined });
    const restored = await run.repos.history.getRecent(100, context);
    expect(restored.ok && restored.value.at(-1)?.id).toBe('assistant-1007');
    // Replay remains idempotent even though startup has closed the original session.
    expect(await run.repos.history.appendTurn(turn(1007), context)).toEqual({ ok: true, value: undefined });
    expect(await run.repos.clear.clearUserMemory({ generation: 1 })).toEqual({ ok: true, value: undefined });
    expect(await run.repos.history.appendTurn(turn(0), context)).toEqual({ ok: false, code: 'stale' });
    await run.client.close(1);
    run = start(filename);
    expect(await run.client.ready).toEqual({ ok: true, value: undefined });
    expect(await run.repos.history.getRecent(100, context)).toEqual({ ok: true, value: [] });
    expect(await run.repos.gameReader.getRecent(20, context)).toEqual({ ok: true, value: [] });
    expect(await run.repos.causalLife.getRecent(100, context)).toEqual({ ok: true, value: [] });
    await run.client.close(0);
    expect(run.worker.threadId).toBe(-1);
    const elapsed = performance.now() - started, used = process.cpuUsage(cpu);
    const sorted = [...recallLatencies].sort((a, b) => a - b);
    task.meta.lifeMemory = { node: process.version, platform: process.platform,
      cpu: os.cpus()[0]?.model, durationMs: elapsed, simulatedDays: 7, syntheticTurns: 1008,
      syntheticCausalEvents: 2016, legacyGameEvents: 1008, exactReplays: 4032, providerRequests: 0,
      cpuUserMs: used.user / 1000, cpuSystemMs: used.system / 1000, samples,
      recallMs: { first10Mean: recallLatencies.slice(0, 10).reduce((a, b) => a + b, 0) / 10,
        last10Mean: recallLatencies.slice(-10).reduce((a, b) => a + b, 0) / 10,
        p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) },
      timersAfterRecall: timers.size, bytesAfterResetAndRestart: dbBytes(),
      scope: 'Native SQLite worker test; accelerated simulation, not desktop soak. RSS/CPU include Vitest and worker. No numeric CPU/RSS budget.' };
  } finally {
    await run.client.close(0);
    for (const timer of timers) clearTimeout(timer);
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
