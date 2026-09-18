import { expect, it } from 'vitest';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import type { PreferenceTrack } from '../../src/domain/character';
import { scenario } from './autonomy-scenario-fixture';

function setup(preference?: PreferenceTrack, energy = 80, random = 0.85) {
  const state = new CharacterStateService({ now: () => 0 }).getState();
  return scenario({}, random, { ...state, needs: { ...state.needs, energy },
    preferences: preference ? { 'activity.cursor_game': preference } : {} });
}
function mature(f: ReturnType<typeof setup>, x = 440) {
  f.main.handleCursorObservation({ x, y: 790 });
  for (let i = 0; i < 5; i++) { f.advance(100); f.main.handleCursorObservation({ x, y: 790 }); }
}
const liked = { value: 100, confidence: 0.8, samples: 24 };

it.each([
  [liked, 'cursor_interest'],
  [{ ...liked, value: -100 }, undefined],
  [undefined, undefined],
  [{ ...liked, confidence: 0.49 }, undefined],
  [{ ...liked, value: NaN }, undefined],
] as const)('uses qualified learned preference in the real Main selection: %j', (preference, expected) => {
  const f = setup(preference);
  try { mature(f); expect(f.main.getActivityTimeline()?.activityId).toBe(expected); }
  finally { f.main.dispose(); }
});

it('waits for dwell and leaves passive gaze chance unchanged outside the mature game opportunity', () => {
  const f = setup(liked);
  try {
    expect(f.main.handleCursorObservation({ x: 440, y: 790 })).toBe(false);
    for (let i = 0; i < 4; i++) { f.advance(100); expect(f.main.handleCursorObservation({ x: 440, y: 790 })).toBe(false); }
    f.advance(100); expect(f.main.handleCursorObservation({ x: 440, y: 790 })).toBe(true);
  } finally { f.main.dispose(); }
  for (const preference of [liked, { ...liked, value: -100 }]) {
    const passive = setup(preference, 80, 0.60);
    try { mature(passive, 500); expect(passive.main.getActivityTimeline()).toBeNull(); }
    finally { passive.main.dispose(); }
  }
});

it.each(['quiet', 'sleep', 'menu', 'disabled', 'movement', 'provider'] as const)(
  'high affinity cannot bypass %s gating', mode => {
    const f = setup(liked, mode === 'sleep' ? 20 : 80, 0);
    try {
      if (mode === 'quiet') f.main.setQuietMode(true);
      if (mode === 'menu') f.main.setMenuOpen(true);
      if (mode === 'disabled') f.main.setEnabled(false);
      if (mode === 'movement') f.setMovable(false);
      if (mode === 'provider') expect(f.offer('respond').status).toBe('admitted');
      mature(f); expect(f.main.getActivityTimeline()?.activityId).not.toBe('cursor_interest');
    } finally { f.main.dispose(); }
  });

it('preserves manual play for negative affinity', () => {
  const baseline = scenario(); const state = baseline.character.getState(); baseline.main.dispose();
  const f = scenario({}, 0, { ...state, preferences: { 'activity.cursor_game': { ...liked, value: -100 } } });
  try { expect(f.play()).toBe(true); expect(f.main.getActivityTimeline()).not.toBeNull(); }
  finally { f.main.dispose(); }
});

it('retains shared cooldown and initiative budget after a highly preferred game', () => {
  const f = setup(liked, 80, 0);
  try {
    mature(f); expect(f.main.getActivityTimeline()?.activityId).toBe('cursor_interest');
    for (let i = 0; i < 28; i++) { f.main.handleCursorObservation({ x: 440, y: 790 }); f.advance(100); }
    expect(f.main.getActivityTimeline()).toBeNull();
    f.main.handleCursorObservation({ x: 900, y: 790 });
    mature(f); expect(f.main.getActivityTimeline()?.activityId).not.toBe('cursor_interest');
    f.advance(31000); mature(f);
    expect(f.main.getActivityTimeline()?.activityId).toBe('cursor_interest');
    for (let i = 0; i < 28; i++) { f.main.handleCursorObservation({ x: 440, y: 790 }); f.advance(100); }
    f.advance(31000); mature(f);
    // Cooldown and minimum interval have elapsed, but both tokens in the 120s window are spent.
    expect(f.main.getActivityTimeline()?.activityId).not.toBe('cursor_interest');
  } finally { f.main.dispose(); }
});
