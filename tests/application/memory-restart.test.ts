import { expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MemoryWorkerClient } from '../../src/infrastructure/memory/worker-client';
import { createMemoryAdapters } from '../../src/infrastructure/memory/adapters';
import { MemoryLifecycle } from '../../src/application/services/memory-lifecycle';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import type { AIProviderContextMessage } from '../../src/application/ports/ai-provider.interface';

function start(filename: string) {
  // Native test TS loader; no packaging/build script or Electron process is required.
  const source = `const { registerHooks, stripTypeScriptTypes } = require('node:module');
    const { readFileSync } = require('node:fs'); const { fileURLToPath } = require('node:url');
    registerHooks({ resolve(specifier, context, next) { try { return next(specifier, context); } catch (error) { if (specifier.startsWith('.')) return next(specifier + '.ts', context); throw error; } },
      load(url, context, next) { return url.endsWith('.ts') ? { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }), shortCircuit: true } : next(url, context); } });
    import(${JSON.stringify(pathToFileURL(path.resolve('src/infrastructure/memory/worker.ts')).href)});`;
  const client = new MemoryWorkerClient({ workerPath: '', filename, now: new Date().toISOString(), createWorker: () => new Worker(source, { eval: true, workerData: { filename, now: new Date().toISOString() } }) });
  const repos = createMemoryAdapters(client); let monotonicMs = 0; const character = new CharacterStateService({ monotonicNow: () => monotonicMs });
  let hydrated: readonly AIProviderContextMessage[] = [];
  const lifecycle = new MemoryLifecycle({ storage: { ...repos, ready: client.ready, close: generation => client.close(generation), abort: () => client.abort() }, character, preferenceLearning: character, scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }, now: Date.now, timestamp: () => new Date().toISOString(), createId: randomUUID, toTimestamp: ms => new Date(ms).toISOString(), localMock: true, start: () => {}, pause: () => {}, resetCommitted: () => {}, resume: () => {}, hydrate: messages => { hydrated = messages; } });
  return { lifecycle, character, repos, context: () => hydrated, advance: (milliseconds: number) => { monotonicMs += milliseconds; } };
}
it('persists individual history/facts/state across real worker restarts and keeps full reset cleared after another restart', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wisp restart память ')); const filename = path.join(directory, 'memory.sqlite3');
  let run = start(filename);
  try {
    await run.lifecycle.initialize(); expect(run.lifecycle.getStatus()).toEqual({ mode: 'persistent', characterRestore: 'default' });
    const now = new Date().toISOString();
    const pair = { memoryGeneration: 0, user: { id: 'u', text: 'Меня зовут Ира', createdAt: now }, assistant: { id: 'a', text: 'Запомню, Ира', createdAt: now } };
    await run.lifecycle.history.completed(pair);
    expect((await run.lifecycle.upsertFact({ id: 'f', factKey: 'user.display_name', factValue: 'Ира', confidence: 1, sourceMessageId: 'u', createdAt: now, updatedAt: now })).ok).toBe(true);
    await run.lifecycle.history.game({ activityRunId: 'g', atMs: Date.now(), outcome: 'caught', playCompleted: true, executedMs: 1000 }, 0);
    run.advance(300000);
    await run.lifecycle.history.completed({ memoryGeneration: 0, user: { id: 'u2', text: 'Мне нравится игра с курсором', createdAt: now }, assistant: { id: 'a2', text: 'Хорошо', createdAt: now } });
    expect(run.character.getState().preferences['activity.cursor_game']).toEqual({ value: 2, samples: 1, confidence: 1 / 7 });
    run.character.applyStimulus({ type: 'user_message', source: 'user', text: 'Привет', createdAt: now });
    const expected = run.character.getState(); await run.lifecycle.shutdown();
    run = start(filename); await run.lifecycle.initialize();
    expect(run.lifecycle.getStatus()).toEqual({ mode: 'persistent', characterRestore: 'restored' });
    expect(run.character.getState().relationship).toEqual(expected.relationship);
    expect(run.context().map(message => message.text)).toEqual(['Меня зовут Ира', 'Запомню, Ира', 'Мне нравится игра с курсором', 'Хорошо']);
    expect(run.character.getState().preferences).toEqual(expected.preferences);
    expect(await run.repos.facts.list(10, { generation: 0 })).toEqual({ ok: true, value: expect.arrayContaining([expect.objectContaining({ factKey: 'user.display_name', factValue: 'Ира', sourceMessageId: 'u' }), expect.objectContaining({ factKey: 'user.cursor_game', factValue: 'like', sourceMessageId: 'u2' })]) });
    expect(await run.lifecycle.reset()).toEqual({ ok: true, value: undefined });
    await run.lifecycle.history.completed(pair);
    expect(await run.repos.history.getRecent(20, { generation: 1 })).toEqual({ ok: true, value: [] });
    expect(await run.repos.facts.list(10, { generation: 1 })).toEqual({ ok: true, value: [] });
    expect(run.character.getState().relationship.friendship).toBe(0); expect(run.character.getState().preferences).toEqual({}); await run.lifecycle.shutdown();
    run = start(filename); await run.lifecycle.initialize(); expect(run.context()).toEqual([]); expect(run.character.getState().relationship.friendship).toBe(0); expect(run.character.getState().preferences).toEqual({});
  } finally { await run.lifecycle.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});
