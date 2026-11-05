import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import { CharacterStateService } from '../../../src/application/services/character-state.service';
import { projectCharacterMemory, restoreCharacterMemory } from '../../../src/application/services/character-memory-snapshot';
import type { PersistedCharacterStateSnapshot } from '../../../src/application/ports/memory-repository.interface';
import type { CausalLifeEpisode } from '../../../src/application/ports/causal-life.interface';
import type { Operation } from '../../../src/infrastructure/memory/protocol';
const now = '2026-11-05T10:00:00.000Z';
it('reopens V4 markers with their exact source and preserves facets without replay or schema migration', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wisp-repair-'));
  let store = SqliteMemoryStore.open(path.join(dir, 'memory.db'), now);
  const run = (operation: Operation, payload: unknown = null) => store.execute({ id: 1, operation, payload, generation: 0 });
  try {
    const source: CausalLifeEpisode = { appRunId: 'old-app', sequence: 2, revision: 1, occurredAt: now, source: 'user', triggerSequence: 1,
      activityRunId: 'game', activity: 'cursor_game', outcome: 'cancelled', terminalReason: 'user_interaction', cause: 'user_interrupted',
      executedMs: 1500, participation: 'user_engaged' };
    expect(run('appendCausalLife', source).ok).toBe(true);
    const character = new CharacterStateService({ now: () => Date.parse(now), monotonicNow: () => 0 });
    const original = character.getState();
    const state = { ...original, relationship: { ...original.relationship, trust: 499, resentment: 2 },
      relationshipRepair: { lastInterruptionAt: now, lastInterruptionSource: { appRunId: source.appRunId, sequence: 2, revision: 1 as const },
        lastRepairAt: null, lastRepairSource: null } };
    const snapshot = projectCharacterMemory(state, now);
    expect(run('saveSnapshot', snapshot).ok).toBe(true); store.close();
    store = SqliteMemoryStore.open(path.join(dir, 'memory.db'), '2026-11-05T10:02:00.000Z');
    const loaded = run('loadSnapshot'); expect(loaded.ok).toBe(true); if (!loaded.ok) return;
    const restored = restoreCharacterMemory(loaded.value as PersistedCharacterStateSnapshot, character.createDefaults(), Date.parse(now) + 120000);
    expect(restored.relationship).toEqual(state.relationship);
    expect(restored.relationshipRepair).toEqual(state.relationshipRepair);
    expect(run('resolveCausalLife', [state.relationshipRepair.lastInterruptionSource])).toEqual({ ok: true, value: [source] });
    const { relationshipRepair: _repair, ...v3state } = snapshot.state;
    expect(run('saveSnapshot', { ...snapshot, snapshotVersion: 3, state: v3state })).toEqual({ ok: false, code: 'invalid_data' });
    expect(run('loadSnapshot')).toEqual({ ok: true, value: snapshot });
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
