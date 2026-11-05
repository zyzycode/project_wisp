import { expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { MemoryWorkerClient } from '../../src/infrastructure/memory/worker-client';
import { createMemoryAdapters } from '../../src/infrastructure/memory/adapters';
import { MemoryLifecycle } from '../../src/application/services/memory-lifecycle';
import { CharacterStateService } from '../../src/application/services/character-state.service';

const base = Date.parse('2026-11-05T10:00:00.000Z');
function start(filename: string, wallAdvance = 0) {
  const source = `const { registerHooks, stripTypeScriptTypes } = require('node:module');
    const { readFileSync } = require('node:fs'); const { fileURLToPath } = require('node:url');
    registerHooks({ resolve(specifier, context, next) { try { return next(specifier, context); } catch (error) { if (specifier.startsWith('.')) return next(specifier + '.ts', context); throw error; } },
      load(url, context, next) { return url.endsWith('.ts') ? { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }), shortCircuit: true } : next(url, context); } });
    import(${JSON.stringify(pathToFileURL(path.resolve('src/infrastructure/memory/worker.ts')).href)});`;
  const timestamp = () => new Date(base + wallAdvance + monotonicMs).toISOString();
  const client = new MemoryWorkerClient({ workerPath: '', filename, now: new Date(base + wallAdvance).toISOString(),
    createWorker: () => new Worker(source, { eval: true, workerData: { filename, now: new Date(base + wallAdvance).toISOString() } }) });
  let monotonicMs = 0;
  const repositories = createMemoryAdapters(client), character = new CharacterStateService({ now: () => 0, monotonicNow: () => monotonicMs });
  const lifecycle = new MemoryLifecycle({ storage: { ...repositories, ready: client.ready, close: generation => client.close(generation), abort: () => client.abort() },
    character, scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    now: () => base + wallAdvance + monotonicMs, monotonicNow: () => monotonicMs, timestamp, toTimestamp: ms => new Date(base + wallAdvance + ms).toISOString(), createId: randomUUID,
    causalObserver: (episode, atMs) => character.observeCausalEpisode(episode, atMs),
    localMock: true, hydrate: () => {}, start: () => {}, pause: () => {}, resetCommitted: () => {}, resume: () => {} });
  return { lifecycle, character, repositories, timestamp, advance: (ms: number) => { monotonicMs += ms; },
    interrupt: () => {
      lifecycle.history.causal.beginInput(false, monotonicMs);
      lifecycle.history.causal.outcome({ type: 'activity_outcome', activity: 'cursor_game', activitySequence: 1, terminalReason: 'user_interaction',
        eventId: 'terminal', activityRunId: 'game', atMs: monotonicMs, family: 'cursor_interest', outcome: 'cancelled', participation: 'user_engaged', executedMs: 2000, playCompleted: false });
      lifecycle.history.causal.endInput();
    } };
}

it('binds a real acknowledged interruption to the persisted user source, restarts without replay and resets all derived rows', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wisp-interpretation-')), filename = path.join(directory, 'memory.sqlite3');
  let run = start(filename);
  try {
    await run.lifecycle.initialize(); const relationship = run.character.getState().relationship; run.advance(2000); run.interrupt();
    expect(run.character.getCausalEmotion()?.intensity).toBe(.2);
    expect(await run.lifecycle.history.completed({ memoryGeneration: 0, memoryConfirmable: true,
      user: { id: 'user-report', text: 'я случайно прервала игру', createdAt: run.timestamp() },
      assistant: { id: 'answer', text: 'Поняла.', createdAt: run.timestamp() } })).toBe(true);
    const saved = await run.repositories.socialInterpretation.read(run.timestamp(), { generation: 0 });
    expect(saved).toMatchObject({ ok: true, value: { status: 'reported_accidental', reports: [{ userMessageId: 'user-report' }] } });
    expect(run.character.getCausalEmotion()?.intensity).toBe(.1);
    expect(run.character.getState().relationship).toEqual(relationship);
    await run.lifecycle.shutdown();
    run = start(filename, 2000); await run.lifecycle.initialize(); await run.lifecycle.socialInterpretation.refresh();
    expect(run.lifecycle.socialInterpretation.getCurrent()?.status).toBe('reported_accidental');
    expect(run.character.getCausalEmotion()).toBeNull();
    await run.lifecycle.history.completed({ memoryGeneration: 0, memoryConfirmable: true,
      user: { id: 'new-user-report', text: 'i interrupted the game deliberately', createdAt: run.timestamp() },
      assistant: { id: 'new-answer', text: 'Okay.', createdAt: run.timestamp() } });
    expect((await run.repositories.socialInterpretation.read(run.timestamp(), { generation: 0 }))).toEqual(saved);
    expect(await run.lifecycle.reset()).toEqual({ ok: true, value: undefined });
    expect(run.lifecycle.socialInterpretation.getCurrent()).toBeNull();
    expect(await run.repositories.socialInterpretation.read(run.timestamp(), { generation: 1 })).toEqual({ ok: true, value: null });
    if (saved.ok && saved.value) expect(await run.repositories.socialInterpretation.replace(saved.value, null, run.timestamp(), { generation: 0 })).toEqual({ ok: false, code: 'stale' });
  } finally { await run.lifecycle.shutdown(); rmSync(directory, { recursive: true, force: true }); }
}, 10000);
