import { expect, it } from 'vitest';
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
it.each(['extra', 'preset', 'axis', 'caps', 'range', 'samples', 'consent', 'version'])('rejects incompatible snapshot %s without clamp', variant => {
  const snapshot = projectCharacterMemory(defaults(), now);
  let input: unknown = snapshot;
  if (variant === 'extra') input = { ...snapshot, state: { ...snapshot.state, fsm: 'sleep' } };
  if (variant === 'preset') input = { ...snapshot, state: { ...snapshot.state, presetId: 'other' } };
  if (variant === 'axis') input = { ...snapshot, state: { ...snapshot.state, currentAxes: { ...snapshot.state.currentAxes, invented: 0.2 } } };
  if (variant === 'caps') input = { ...snapshot, state: { ...snapshot.state, currentAxes: { ...snapshot.state.currentAxes, boldness: 1 } } };
  if (variant === 'range') input = { ...snapshot, state: { ...snapshot.state, needs: { ...snapshot.state.needs, energy: 101 } } };
  if (variant === 'samples') input = { ...snapshot, state: { ...snapshot.state, preferences: { music: { value: 10, confidence: 0.4, samples: 1.5 } } } };
  if (variant === 'consent') input = { ...snapshot, state: { ...snapshot.state, intimacy: { ...snapshot.state.intimacy, userConsentEnabled: 'yes' } } };
  if (variant === 'version') input = { ...snapshot, snapshotVersion: 2 };
  expect(() => restoreCharacterMemory(input as typeof snapshot, defaults(), 1000)).toThrow();
});
