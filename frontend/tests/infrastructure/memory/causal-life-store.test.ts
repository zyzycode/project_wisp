import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import type { CausalLifeEpisode } from '../../../src/application/ports/causal-life.interface';

const now = '2026-11-05T00:00:00.000Z';
const dirs: string[] = [], stores: SqliteMemoryStore[] = [];
const contact: CausalLifeEpisode = { appRunId: 'app', sequence: 1, revision: 1, occurredAt: now, source: 'user', triggerSequence: null, activityRunId: null, activity: null, outcome: null, terminalReason: null, cause: 'contact', executedMs: 0, participation: 'none' };
const terminal: CausalLifeEpisode = { ...contact, sequence: 3, triggerSequence: 2, activityRunId: 'run', activity: 'cursor_game', outcome: 'cancelled', terminalReason: 'user_interaction', cause: 'user_interrupted', executedMs: 1500, participation: 'user_engaged' };
function fixture() { const dir = mkdtempSync(path.join(os.tmpdir(), 'wisp-causal-')); dirs.push(dir); const file = path.join(dir, 'memory.db'); const store = SqliteMemoryStore.open(file, now); stores.push(store); return { store, file }; }
function run(store: SqliteMemoryStore, operation: string, payload: unknown, generation = 0) { return store.execute({ id: 1, operation, payload, generation }); }
afterEach(() => { stores.splice(0).forEach(s => s.close()); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
it('persists exact immutable identities, indexed source resolution and insertion order across restart', () => {
  const { store, file } = fixture();
  expect(run(store, 'appendCausalLife', contact)).toEqual({ ok: true, value: undefined });
  expect(run(store, 'appendCausalLife', terminal).ok).toBe(true);
  expect(run(store, 'appendCausalLife', terminal).ok).toBe(true);
  expect(run(store, 'appendCausalLife', { ...terminal, executedMs: 2000 })).toEqual({ ok: false, code: 'conflict' });
  expect(run(store, 'appendCausalLife', { ...terminal, sequence: 4 })).toEqual({ ok: false, code: 'conflict' });
  store.close(); const reopened = SqliteMemoryStore.open(file, now); stores.push(reopened);
  expect(run(reopened, 'recentCausalLife', 100)).toEqual({ ok: true, value: [contact, terminal] });
  expect(run(reopened, 'resolveCausalLife', [{ appRunId: 'app', sequence: 3, revision: 1 }, { appRunId: 'missing', sequence: 1, revision: 1 }])).toEqual({ ok: true, value: [terminal] });
});
it('validates cause/terminal/source bindings and bounded indexed arguments', () => {
  const { store } = fixture();
  for (const bad of [{ ...terminal, triggerSequence: null }, { ...terminal, source: 'system' }, { ...terminal, triggerSequence: 3 }, { ...terminal, outcome: 'completed' }, { ...contact, activityRunId: 'fake' }, { ...terminal, executedMs: Infinity }, { ...terminal, revision: 2 }, { ...terminal, extra: 'private' }, { ...terminal, cause: 'environment_lost' }, { ...terminal, cause: 'other' }, { ...terminal, source: 'unknown', cause: 'unknown' }]) expect(run(store, 'appendCausalLife', bad)).toEqual({ ok: false, code: 'invalid_data' });
  expect(run(store, 'recentCausalLife', 0)).toEqual({ ok: false, code: 'invalid_data' });
  const ref = { appRunId: 'app', sequence: 1, revision: 1 };
  expect(run(store, 'resolveCausalLife', [ref, ref])).toEqual({ ok: false, code: 'invalid_data' });
  expect(run(store, 'resolveCausalLife', Array.from({ length: 21 }, (_, i) => ({ ...ref, sequence: i + 1 })))).toEqual({ ok: false, code: 'invalid_data' });
});
it('clears causal sources with the existing reset and rejects stale callbacks', () => {
  const { store } = fixture(); run(store, 'appendCausalLife', terminal);
  expect(run(store, 'clear', null, 1).ok).toBe(true);
  expect(run(store, 'appendCausalLife', terminal)).toEqual({ ok: false, code: 'stale' });
  expect(run(store, 'recentCausalLife', 100, 1)).toEqual({ ok: true, value: [] });
});
