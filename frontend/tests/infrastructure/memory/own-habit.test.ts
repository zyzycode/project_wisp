import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import { CharacterStateService } from '../../../src/application/services/character-state.service';
import { projectCharacterMemory, restoreCharacterMemory } from '../../../src/application/services/character-memory-snapshot';
import type { PersistedCharacterStateSnapshot } from '../../../src/application/ports/memory-repository.interface';
import type { Operation } from '../../../src/infrastructure/memory/protocol';
const now = '2026-11-05T10:00:00.000Z';
it('reopens V5 with bounded habit evidence and V4 repair fields intact, without cue or historical execution', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wisp-habit-'));
  let store = SqliteMemoryStore.open(path.join(dir, 'memory.db'), now);
  const run = (operation: Operation, payload: unknown = null, generation = 0) => store.execute({ id: 1, operation, payload, generation });
  try {
    const character = new CharacterStateService({ now: () => Date.parse(now), monotonicNow: () => 0 });
    const state = character.getState();
    const source = { appRunId: 'prior', sequence: 2, revision: 1 as const };
    const value = { ...state, relationshipRepair: { lastInterruptionAt: now, lastInterruptionSource: source, lastRepairAt: null, lastRepairSource: null },
      ownHabitMemory: { lastLearnedAt: now, transitions: Array.from({ length: 20 }, (_, i) => ({ appRunId: 'prior', exploreRunId: `e${i}`,
        nextRunId: `c${i}`, nextKind: 'calm_look_around' as const, completedAt: now })) } };
    const snapshot = projectCharacterMemory(value, now);
    expect(run('saveSnapshot', snapshot).ok).toBe(true); store.close();
    store = SqliteMemoryStore.open(path.join(dir, 'memory.db'), now);
    const loaded = run('loadSnapshot'); expect(loaded.ok).toBe(true); if (!loaded.ok) return;
    character.replaceRestoredState(restoreCharacterMemory(loaded.value as PersistedCharacterStateSnapshot, character.createDefaults(), Date.parse(now)));
    expect(character.getState().ownHabitMemory).toEqual(value.ownHabitMemory);
    expect(character.getState().relationshipRepair).toEqual(value.relationshipRepair);
    expect(character.getOwnHabitMultiplier()).toBe(1);
    const { ownHabitMemory: _habit, ...v4 } = snapshot.state;
    expect(run('saveSnapshot', { ...snapshot, snapshotVersion: 4, state: v4 })).toEqual({ ok: false, code: 'invalid_data' });
    expect(run('clear', undefined, 1).ok).toBe(true);
    expect(run('saveSnapshot', snapshot, 0)).toEqual({ ok: false, code: 'stale' });
    expect(run('loadSnapshot', null, 1)).toEqual({ ok: true, value: null });
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
