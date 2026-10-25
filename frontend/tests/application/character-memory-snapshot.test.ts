import { expect, it } from 'vitest';
import type { JsonValue } from '../../src/application/ports/memory-repository.interface';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { projectCharacterMemory, restoreCharacterMemory } from '../../src/application/services/character-memory-snapshot';
const now = '2026-09-18T00:00:00.000Z';
const defaults = () => new CharacterStateService({ now: () => 100 }).getState();
it('restores only dynamic fields, keeping installed preset metadata/caps and a fresh domain clock', () => {
  const state = defaults(); state.relationship = { friendship: 600, love: 200, loveUnlocked: true }; state.intimacy.userConsentEnabled = false;
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
  if (variant === 'version') input = { ...snapshot, snapshotVersion: 3 };
  expect(() => restoreCharacterMemory(input as typeof snapshot, defaults(), 1000)).toThrow();
});

function legacySnapshot() {
  const { cardRevision: _revision, ...state } = projectCharacterMemory(defaults(), now).state;
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
  for (const key of ['needs', 'relationship', 'intimacy', 'preferences'] as const) expect(migrated[key]).toEqual(legacy.state[key]);
  expect(legacy).toEqual(before); expect(restoreCharacterMemory(legacy, defaults(), 1000)).toEqual(migrated);
  migrated.personality.axes.boldness.current = 0.8;
  const next = projectCharacterMemory(migrated, now);
  expect(next.snapshotVersion).toBe(2); expect(next.state.cardRevision).toBe(2);
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
