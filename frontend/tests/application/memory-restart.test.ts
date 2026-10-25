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
import { scenario } from '../main/autonomy-scenario-fixture';
import { calculateCursorNoticeChance } from '../../src/domain/behavior/cursor-observe-policy';
import type { CharacterState } from '../../src/domain/character';
import { createCharacterAutonomySnapshot } from '../../src/domain/character/autonomy-character-engine';
import { selectLocalActivity } from '../../src/domain/behavior/local-activity-policy';

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

it.each(['like', 'dislike'] as const)('keeps %s-driven eligible game selection across a real SQLite restart', async disposition => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wisp-preference-restart-'));
  const filename = path.join(directory, 'memory.sqlite3');
  let run = start(filename);
  const defaults = new CharacterStateService({ now: () => 0 }).getSnapshot();
  const draw = calculateCursorNoticeChance('contact', { nowMs: 0, needs: defaults.needs,
    tone: defaults.synthesizedTone, friendship: defaults.relationship.friendship }) + 0.002;
  const selectedGame = (state: CharacterState) => {
    const f = scenario({}, draw, state);
    try {
      f.main.handleCursorObservation({ x: 440, y: 790 });
      for (let i = 0; i < 5; i++) { f.advance(100); f.main.handleCursorObservation({ x: 440, y: 790 }); }
      return f.main.getActivityTimeline()?.activityId === 'cursor_interest';
    } finally { f.main.dispose(); }
  };
  try {
    await run.lifecycle.initialize();
    expect(selectedGame(run.character.getState())).toBe(false);
    const now = new Date().toISOString();
    for (let i = 0; i < 6; i++) {
      run.advance(300000);
      await run.lifecycle.history.completed({ memoryGeneration: 0,
        user: { id: `u${i}`, text: disposition === 'like' ? 'Мне нравится игра с курсором' : 'Мне не нравится игра с курсором', createdAt: now },
        assistant: { id: `a${i}`, text: 'Понятно', createdAt: now } });
    }
    const expected = run.character.getState().preferences['activity.cursor_game'];
    expect(expected).toEqual({ value: disposition === 'like' ? 12 : -12, samples: 6, confidence: 0.5 });
    expect(selectedGame(run.character.getState())).toBe(disposition === 'like');
    await run.lifecycle.shutdown();
    run = start(filename); await run.lifecycle.initialize();
    expect(run.lifecycle.getStatus()).toEqual({ mode: 'persistent', characterRestore: 'restored' });
    expect(run.character.getState().preferences['activity.cursor_game']).toEqual(expected);
    expect(selectedGame(run.character.getState())).toBe(disposition === 'like');
  } finally { await run.lifecycle.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});

it.each([
  ['activity.explore', 'Мне нравятся твои прогулки', 'Мне не нравятся твои прогулки'],
  ['activity.social_bid', 'Мне нравятся твои инициативы общения', 'Мне не нравятся твои инициативы общения'],
] as const)('preserves paired persisted %s choices after restart and returns both to baseline after reset', async (key, like, dislike) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wisp-local-preferences-'));
  const filenames = ['like.sqlite3', 'dislike.sqlite3'].map(file => path.join(directory, file));
  let runs = filenames.map(start);
  const initial = new CharacterStateService({ now: () => 0 }).getState();
  // Control transient Needs/relationship for both histories, keeping the real authored axes.
  const projection = (state: CharacterState) => createCharacterAutonomySnapshot({ ...state,
    needs: { energy: 51, comfort: 0, attention: 80, play: 0, boredom: 24 }, relationship: { ...state.relationship, friendship: 100 } });
  const selection = { nowMs: 0, canExplore: key === 'activity.explore', canSocial: key === 'activity.social_bid', canPlay: false, canRest: false, history: [] };
  const baseline = selectLocalActivity(projection(initial), selection, 0).trace;
  const draw = baseline[0]!.score / baseline.reduce((sum, row) => sum + row.score, 0);
  const choose = (state: CharacterState) => selectLocalActivity(projection(state), selection, draw).intent.kind;
  const target = key === 'activity.explore' ? 'wander' : 'play';
  const fullBaseline = selectLocalActivity(projection(initial), { ...selection, canExplore: true, canSocial: true, canRest: true }, 0).trace;
  const targetFamily = key === 'activity.explore' ? 'wander' : 'social_bid';
  const mainDraw = fullBaseline.slice(0, fullBaseline.findIndex(row => row.kind === targetFamily)).reduce((sum, row) => sum + row.score, 0)
    / fullBaseline.reduce((sum, row) => sum + row.score, 0);
  const mainChoosesTarget = (state: CharacterState) => {
    const controlled = projection(state);
    const f = scenario({}, mainDraw, { ...state, needs: controlled.needs, relationship: { ...state.relationship, friendship: 100 } }, undefined, {}, true);
    try { f.pulse(); return f.main.getActivityTimeline()?.activityId === (key === 'activity.explore' ? 'explore' : 'social_bid'); }
    finally { f.main.dispose(); }
  };
  try {
    for (const run of runs) await run.lifecycle.initialize();
    const now = new Date().toISOString();
    for (let sample = 1; sample <= 6; sample++) {
      for (const [index, run] of runs.entries()) {
        run.advance(300000);
        await run.lifecycle.history.completed({ memoryGeneration: 0,
          user: { id: `u-${sample}`, text: index === 0 ? like : dislike, createdAt: now },
          assistant: { id: `a-${sample}`, text: 'Хорошо', createdAt: now } });
      }
    }
    expect(runs.map(run => run.character.getState().preferences[key])).toEqual([
      { value: 12, confidence: .5, samples: 6 }, { value: -12, confidence: .5, samples: 6 },
    ]);
    expect(runs.map(run => choose(run.character.getState()))).toEqual([target, 'idle']);
    expect(runs.map(run => mainChoosesTarget(run.character.getState()))).toEqual([true, false]);
    for (const run of runs) await run.lifecycle.shutdown();
    runs = filenames.map(start);
    for (const run of runs) await run.lifecycle.initialize();
    expect(runs.map(run => run.character.getState().preferences[key])).toEqual([
      { value: 12, confidence: .5, samples: 6 }, { value: -12, confidence: .5, samples: 6 },
    ]);
    expect(runs.map(run => choose(run.character.getState()))).toEqual([target, 'idle']);
    expect(runs.map(run => mainChoosesTarget(run.character.getState()))).toEqual([true, false]);
    for (const run of runs) {
      expect(run.lifecycle.getStatus()).toEqual({ mode: 'persistent', characterRestore: 'restored' });
      const before = run.character.getState().preferences;
      await run.lifecycle.history.completed({ memoryGeneration: 0,
        user: { id: 'early-after-restart', text: like, createdAt: now }, assistant: { id: 'early-reply', text: 'Хорошо', createdAt: now } });
      expect(run.character.getState().preferences).toEqual(before);
      expect(await run.lifecycle.reset()).toEqual({ ok: true, value: undefined });
      expect(run.character.getState().preferences).toEqual({});
      expect(await run.repos.facts.list(100, { generation: 1 })).toEqual({ ok: true, value: [] });
      run.advance(299999);
      await run.lifecycle.history.completed({ memoryGeneration: 1,
        user: { id: 'early-after-reset', text: like, createdAt: now }, assistant: { id: 'reset-reply', text: 'Хорошо', createdAt: now } });
      expect(run.character.getState().preferences).toEqual({});
    }
    expect(runs.map(run => choose(run.character.getState()))).toEqual([choose(initial), choose(initial)]);
    expect(runs.map(run => mainChoosesTarget(run.character.getState()))).toEqual([mainChoosesTarget(initial), mainChoosesTarget(initial)]);
  } finally { for (const run of runs) await run.lifecycle.shutdown(); rmSync(directory, { recursive: true, force: true }); }
}, 15000);
