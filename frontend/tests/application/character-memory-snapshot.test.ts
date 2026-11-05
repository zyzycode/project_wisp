import { createRelationship, projectRelationship } from '../../src/domain/character/relationship-facets';
import { expect, it } from 'vitest';
import type { JsonValue } from '../../src/application/ports/memory-repository.interface';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { projectCharacterMemory, restoreCharacterMemory } from '../../src/application/services/character-memory-snapshot';
const now = '2026-09-18T00:00:00.000Z';
const defaults = () => new CharacterStateService({ now: () => 100 }).getState();
it('restores only dynamic fields, keeping installed preset metadata/caps and a fresh domain clock', () => {
  const state = defaults(); state.relationship = createRelationship({ friendship: 600, love: 200, loveUnlocked: true }); state.intimacy.userConsentEnabled = false;
  state.preferences = { jazz: { value: 80, confidence: 0.5, samples: 6 } };
  const snapshot = projectCharacterMemory(state, now); const restored = restoreCharacterMemory(snapshot, defaults(), 1000);
  expect(restored.relationship).toEqual(state.relationship); expect(restored.preferences).toEqual(state.preferences);
  expect(restored.intimacy.userConsentEnabled).toBe(false); expect(restored.personality).toEqual(state.personality); expect(restored.lastUpdated).toBe(1000);
  expect(snapshot.state).not.toHaveProperty('lastUpdated'); expect(snapshot.state).not.toHaveProperty('personality');
});
it.each(['extra', 'preset', 'axis', 'caps', 'range', 'samples', 'consent', 'version', 'revision'])('rejects incompatible snapshot %s without clamp', variant => {
  const snapshot = projectCharacterMemory(defaults(), now);
  let input: unknown = snapshot;
  if (variant === 'extra') input = { ...snapshot, state: { ...snapshot.state, fsm: 'sleep' } };
  if (variant === 'preset') input = { ...snapshot, state: { ...snapshot.state, presetId: 'other' } };
  if (variant === 'axis') input = { ...snapshot, state: { ...snapshot.state, currentAxes: { ...snapshot.state.currentAxes, invented: 0.2 } } };
  if (variant === 'caps') input = { ...snapshot, state: { ...snapshot.state, currentAxes: { ...snapshot.state.currentAxes, boldness: 1 } } };
  if (variant === 'range') input = { ...snapshot, state: { ...snapshot.state, needs: { ...snapshot.state.needs, energy: 101 } } };
  if (variant === 'samples') input = { ...snapshot, state: { ...snapshot.state, preferences: { music: { value: 10, confidence: 0.4, samples: 1.5 } } } };
  if (variant === 'consent') input = { ...snapshot, state: { ...snapshot.state, intimacy: { ...snapshot.state.intimacy, userConsentEnabled: 'yes' } } };
  if (variant === 'revision') input = { ...snapshot, state: { ...snapshot.state, cardRevision: 1 } };
  if (variant === 'version') input = { ...snapshot, snapshotVersion: 7 };
  expect(() => restoreCharacterMemory(input as typeof snapshot, defaults(), 1000)).toThrow();
});

function legacySnapshot() {
  const { ownBookInterestSources: _book, cardRevision: _revision, ownHabitMemory: _habit, relationshipRepair: _repair, ownGameInterestSources: _sources, ...state } = projectCharacterMemory(defaults(), now).state;
  return { snapshotVersion: 1, updatedAt: now, state: { ...state, presetId: 'shyDreamGirl',
    currentAxes: { openness: 0.2, extraversion: 0.05, agreeableness: 1, sensitivity: 1, playfulness: 0.1, boldness: 0.02, independence: 0.2 },
    needs: { energy: 12, attention: 34, play: 56, comfort: 78, boredom: 90 },
    relationship: { friendship: 700, love: 100, loveUnlocked: true },
    intimacy: { flirtiness: 10, romanticCharge: 20, userConsentEnabled: false, boundariesKnown: true },
    preferences: { 'activity.explore': { value: -80, confidence: 0.8, samples: 30 }, jazz: { value: 100, confidence: 1, samples: 5 } },
  } };
}
it('migrates exact legacy caps, resets only axes, preserves all dynamic knowledge and is pure across crash/retry', () => {
  const legacy = legacySnapshot(), before = structuredClone(legacy);
  const migrated = restoreCharacterMemory(legacy, defaults(), 1000);
  expect(migrated.personality.id).toBe('curiousStubbornGirl');
  expect(migrated.personality.axes).toEqual(defaults().personality.axes);
  for (const key of ['needs', 'intimacy', 'preferences'] as const) expect(migrated[key]).toEqual(legacy.state[key]);
  expect(migrated.relationship).toEqual(createRelationship(legacy.state.relationship));
  expect(migrated.ownGameInterestSources).toEqual([]);
  expect(legacy).toEqual(before); expect(restoreCharacterMemory(legacy, defaults(), 1000)).toEqual(migrated);
  migrated.personality.axes.boldness.current = 0.8;
  const next = projectCharacterMemory(migrated, now);
  expect(next.snapshotVersion).toBe(6); expect(next.state.cardRevision).toBe(3);
  expect(restoreCharacterMemory(next, defaults(), 2000).personality.axes.boldness.current).toBe(0.8);
});
it.each(['caps', 'preset', 'extra', 'revision', 'missing', 'preference'])('rejects malformed legacy %s before resetting axes', variant => {
  const legacy = legacySnapshot(); let state: JsonValue = legacy.state;
  if (variant === 'caps') state = { ...legacy.state, currentAxes: { ...legacy.state.currentAxes, boldness: 0.6 } };
  if (variant === 'preset') state = { ...legacy.state, presetId: 'curiousStubbornGirl' };
  if (variant === 'extra') state = { ...legacy.state, biography: 'ignored?' };
  if (variant === 'revision') state = { ...legacy.state, cardRevision: 1 };
  if (variant === 'missing') { const { boredom: _boredom, ...needs } = legacy.state.needs; state = { ...legacy.state, needs }; }
  if (variant === 'preference') state = { ...legacy.state, preferences: { jazz: { value: 1, confidence: 2, samples: 2 } } };
  expect(() => restoreCharacterMemory({ ...legacy, state }, defaults(), 1000)).toThrow();
});

it('never retags an unknown Domain identity as the active persisted profile', () => {
  const state = defaults(); state.personality = { ...state.personality, id: 'other' };
  expect(() => projectCharacterMemory(state, now)).toThrow('Invalid active preset');
});

it('persists independent V3 facets and exact source refs without replay on restore', () => {
  const state = defaults();
  state.relationship = { ...state.relationship, familiarity: 700, friendship: 700, affection: 900, trust: 321, respect: 654, resentment: 87, comfort: 432 };
  const withSources = { ...state, ownGameInterestSources: [{ appRunId: 'prior-run', sequence: 42, revision: 1 as const }] };
  const snapshot = projectCharacterMemory(withSources, now), before = structuredClone(snapshot);
  const restored = restoreCharacterMemory(snapshot, defaults(), 1000);
  expect(restored.relationship).toEqual(withSources.relationship);
  expect(restored.ownGameInterestSources).toEqual(withSources.ownGameInterestSources);
  expect(projectCharacterMemory(restored, now)).toEqual(snapshot);
  expect(snapshot).toEqual(before);
});

it.each(['missing', 'range', 'mismatch', 'nan', 'sourceLimit', 'sourceDuplicate', 'sourceRevision', 'sourceExtra'])('rejects malformed V3 %s without downgrading or clamping', variant => {
  const snapshot = projectCharacterMemory(defaults(), now);
  let state: JsonValue = snapshot.state;
  if (variant === 'missing') { const { trust: _trust, ...relationship } = snapshot.state.relationship; state = { ...snapshot.state, relationship }; }
  if (variant === 'range') state = { ...snapshot.state, relationship: { ...snapshot.state.relationship, resentment: 1001 } };
  if (variant === 'mismatch') state = { ...snapshot.state, relationship: { ...snapshot.state.relationship, familiarity: 12 } };
  if (variant === 'nan') state = { ...snapshot.state, relationship: { ...snapshot.state.relationship, comfort: NaN } };
  const ref = { appRunId: 'app', sequence: 1, revision: 1 };
  if (variant === 'sourceLimit') state = { ...snapshot.state, ownGameInterestSources: Array.from({ length: 21 }, (_, i) => ({ ...ref, sequence: i + 1 })) };
  if (variant === 'sourceDuplicate') state = { ...snapshot.state, ownGameInterestSources: [ref, ref] };
  if (variant === 'sourceRevision') state = { ...snapshot.state, ownGameInterestSources: [{ ...ref, revision: 2 }] };
  if (variant === 'sourceExtra') state = { ...snapshot.state, ownGameInterestSources: [{ ...ref, privateText: 'untrusted' }] };
  expect(() => restoreCharacterMemory({ ...snapshot, state }, defaults(), 1000)).toThrow();
});

it.each([2, 3])('restores revision %s dynamics onto the installed card and writes only revision 3', cardRevision => {
  const state = defaults();
  state.needs = { energy: 23, attention: 45, play: 67, comfort: 12, boredom: 34 };
  state.relationship = createRelationship({ friendship: 600, love: 200, loveUnlocked: true });
  state.intimacy = { flirtiness: 12, romanticCharge: 34, userConsentEnabled: true, boundariesKnown: true };
  state.personality.axes.boldness.current = 0.8;
  state.preferences = { jazz: { value: 80, confidence: 0.5, samples: 6 } };
  const projected = projectCharacterMemory(state, now);
  const { ownBookInterestSources: _book, ownHabitMemory: _habit, relationshipRepair: _repair, ownGameInterestSources: _sources, ...v2State } = projected.state;
  const snapshot = { ...projected, snapshotVersion: 2, state: { ...v2State, relationship: projectRelationship(state.relationship), cardRevision } };
  const before = structuredClone(snapshot);
  const restored = restoreCharacterMemory(snapshot, defaults(), 1000);
  for (const key of ['needs', 'relationship', 'intimacy', 'preferences'] as const) expect(restored[key]).toEqual(state[key]);
  expect(restored.personality.axes).toEqual(state.personality.axes);
  expect(restored.personality.aiSelfConcept).toBe(defaults().personality.aiSelfConcept);
  expect(snapshot).toEqual(before);
  expect(restoreCharacterMemory(snapshot, defaults(), 1000)).toEqual(restored);
  expect(projectCharacterMemory(restored, now)).toMatchObject({ snapshotVersion: 6, state: { cardRevision: 3 } });
});

it('migrates V3 with null repair marker pairs while preserving all prior dynamic values', () => {
  const projected = projectCharacterMemory(defaults(), now);
  const { ownBookInterestSources: _book, ownHabitMemory: _habit, relationshipRepair: _repair, ...state } = projected.state;
  const restored = restoreCharacterMemory({ ...projected, snapshotVersion: 3, state }, defaults(), 1000);
  expect(restored.relationshipRepair).toEqual({ lastInterruptionAt: null, lastInterruptionSource: null, lastRepairAt: null, lastRepairSource: null });
  expect(projectCharacterMemory(restored, now).state).toEqual(projected.state);
});
it.each(['half-pair', 'invalid-time', 'source-extra', 'source-revision'] as const)('rejects malformed repair checkpoint %s', variant => {
  const projected = projectCharacterMemory(defaults(), now);
  const ref = { appRunId: 'old', sequence: 2, revision: 1 };
  const relationshipRepair = { ...projected.state.relationshipRepair, lastInterruptionAt: variant === 'invalid-time' ? 'tomorrow' : now,
    lastInterruptionSource: variant === 'half-pair' ? null : variant === 'source-extra' ? { ...ref, text: 'private' } : { ...ref, revision: variant === 'source-revision' ? 2 : 1 } };
  expect(() => restoreCharacterMemory({ ...projected, state: { ...projected.state, relationshipRepair } }, defaults(), 1000)).toThrow();
});
it('migrates V4 with neutral habit memory and preserves nonneutral repair markers', () => {
  const projected = projectCharacterMemory(defaults(), now);
  const { ownBookInterestSources: _book, ownHabitMemory: _habit, ...state } = projected.state;
  const repair = { lastInterruptionAt: now, lastInterruptionSource: { appRunId: 'app', sequence: 2, revision: 1 as const }, lastRepairAt: null, lastRepairSource: null };
  const restored = restoreCharacterMemory({ ...projected, snapshotVersion: 4, state: { ...state, relationshipRepair: repair } }, defaults(), 1000);
  expect(restored.ownHabitMemory).toEqual({ transitions: [], lastLearnedAt: null });
  expect(restored.relationshipRepair).toEqual(repair);
  expect(projectCharacterMemory(restored, now).snapshotVersion).toBe(6);
});
it.each(['limit', 'duplicate', 'same-run', 'kind', 'date', 'clock', 'extra'] as const)('rejects malformed V5 habit %s without changing state', variant => {
  const snapshot = projectCharacterMemory(defaults(), now);
  const t = { appRunId: 'app', exploreRunId: 'e', nextRunId: 'c', nextKind: 'calm_look_around', completedAt: now };
  const transitions = variant === 'limit' ? Array.from({ length: 21 }, (_, i) => ({ ...t, exploreRunId: `e${i}` }))
    : variant === 'duplicate' ? [t, t] : [{ ...t, ...(variant === 'same-run' ? { nextRunId: 'e' } : {}),
      ...(variant === 'kind' ? { nextKind: 'sleep' } : {}), ...(variant === 'date' ? { completedAt: 'yesterday' } : {}),
      ...(variant === 'extra' ? { userText: 'private' } : {}) }];
  expect(() => restoreCharacterMemory({ ...snapshot, state: { ...snapshot.state,
    ownHabitMemory: { transitions, lastLearnedAt: variant === 'clock' ? null : now } } }, defaults(), 1000)).toThrow();
});
