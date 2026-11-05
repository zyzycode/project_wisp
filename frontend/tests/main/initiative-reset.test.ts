import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../src/infrastructure/memory/sqlite-store';
import { MemoryLifecycle } from '../../src/application/services/memory-lifecycle';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import type { MemoryRepositories } from '../../src/application/ports/memory-runtime';
import { MainInitiativeComposition } from '../../src/main/main-initiative-composition';
const directories: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it('uses the real reset pause hook to reject old-profile consent before deferred SQLite acknowledgement in the same Brain stream', async () => {
  vi.useFakeTimers(); vi.setSystemTime('2026-11-05T00:00:00.000Z');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wisp-initiative-reset-')); directories.push(directory);
  const store = SqliteMemoryStore.open(path.join(directory, 'memory.db'), new Date().toISOString());
  let acknowledge!: () => void;
  const pending = new Promise<void>(yes => { acknowledge = yes; });
  const controls = new MainInitiativeComposition({ now: Date.now, streamId: () => 'unchanged-stream', createId: () => 'id', generation: () => 0,
    events: () => undefined, conditions: () => ({ memory: true, quiet: false, sleeping: false, away: false, busy: false }),
    needs: () => ({ boredom: 70, energy: 70 }), noCausal: () => true,
    screen: () => ({ id: 'screen', x: 0, y: 0, width: 1000, height: 800 }),
    insets: () => ({ left: 10, right: 10, top: 10, bottom: 10 }), publish: vi.fn() });
  controls.configure(true);
  const storage: MemoryRepositories = {
    ready: Promise.resolve({ ok: true, value: undefined }),
    history: { appendTurn: async () => ({ ok: true, value: undefined }), getRecent: async () => ({ ok: true, value: [] }),
      closeSession: async () => ({ ok: true, value: undefined }), closeUnfinishedSessions: async () => ({ ok: true, value: undefined }) },
    episodes: { append: async () => ({ ok: true, value: undefined }) },
    facts: { upsert: async fact => ({ ok: true, value: fact }), removeByKey: async () => ({ ok: true, value: undefined }), list: async () => ({ ok: true, value: [] }) },
    character: { load: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
    clear: { clearUserMemory: async context => {
      const result = store.execute({ id: 1, operation: 'clear', payload: null, generation: context.generation });
      await pending;
      return result.ok ? { ok: true, value: undefined } : result;
    } }, close: async () => undefined, abort: async () => undefined,
  };
  const memory = new MemoryLifecycle({ storage, character: new CharacterStateService({ now: Date.now }),
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    now: Date.now, timestamp: () => new Date().toISOString(), toTimestamp: ms => new Date(ms).toISOString(), createId: () => 'app',
    localMock: true, start: vi.fn(), pause: () => controls.resetProfile(), resume: vi.fn(), resetCommitted: vi.fn(), hydrate: vi.fn(), invalidateMemory: vi.fn() });
  try {
    await memory.initialize();
    await controls.controls.setConsent({ streamId: 'unchanged-stream', profileGeneration: 0, enabled: true });
    const reset = memory.reset();
    expect(controls.controls.status()).toMatchObject({ enabled: false, profileGeneration: 1 });
    expect(await controls.controls.setConsent({ streamId: 'unchanged-stream', profileGeneration: 0, enabled: true })).toEqual({ ok: false, code: 'stale' });
    acknowledge(); expect(await reset).toEqual({ ok: true, value: undefined });
    expect(controls.controls.status().enabled).toBe(false);
    await memory.shutdown();
  } finally { store.close(); }
});
