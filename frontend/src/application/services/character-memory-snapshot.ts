import type { CharacterState, PersonalityAxis } from '../../domain/character';
import { validDynamicCharacterState } from '../../domain/character/state-validation';
import type { CharacterMemorySnapshotV2 } from '../ports/character-memory-snapshot';
import type { PersistedCharacterStateSnapshot } from '../ports/memory-repository.interface';
import { exactRecord } from '../../shared/dialogue-ipc-validation';

const axes: readonly PersonalityAxis[] = ['openness', 'extraversion', 'agreeableness', 'sensitivity', 'playfulness', 'boldness', 'independence'];
// Frozen revision-1 hard caps from 84eba09; no legacy authored identity/runtime path.
const legacyHardCaps: Readonly<Record<PersonalityAxis, readonly [number, number]>> = {
  openness: [0.2, 0.9], extraversion: [0.05, 0.7], agreeableness: [0.45, 1],
  sensitivity: [0.5, 1], playfulness: [0.1, 0.85], boldness: [0.02, 0.58], independence: [0.2, 0.95],
};
function number(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Invalid snapshot'); return value; }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') throw new TypeError('Invalid snapshot'); return value; }
export function projectCharacterMemory(state: CharacterState, updatedAt: string): CharacterMemorySnapshotV2 {
  if (state.personality.id !== 'curiousStubbornGirl') throw new TypeError('Invalid active preset');
  const a = state.personality.axes;
  return { snapshotVersion: 2, updatedAt, state: {
    presetId: 'curiousStubbornGirl', cardRevision: 2,
    needs: { energy: state.needs.energy, attention: state.needs.attention, play: state.needs.play, comfort: state.needs.comfort, boredom: state.needs.boredom ?? 15 },
    relationship: { ...state.relationship }, intimacy: { ...state.intimacy },
    currentAxes: { openness: a.openness.current, extraversion: a.extraversion.current, agreeableness: a.agreeableness.current, sensitivity: a.sensitivity.current, playfulness: a.playfulness.current, boldness: a.boldness.current, independence: a.independence.current },
    preferences: Object.fromEntries(Object.entries(state.preferences).map(([key, value]) => [key, { ...value }])),
  } };
}
export function restoreCharacterMemory(snapshot: PersistedCharacterStateSnapshot, defaults: CharacterState, now: number): CharacterState {
  const legacy = snapshot.snapshotVersion === 1;
  if (!legacy && snapshot.snapshotVersion !== 2) throw new TypeError('Unsupported snapshot');
  const state = exactRecord(snapshot.state, ['presetId', 'needs', 'relationship', 'intimacy', 'currentAxes', 'preferences', ...(legacy ? [] : ['cardRevision'])]);
  if (state.presetId !== (legacy ? 'shyDreamGirl' : 'curiousStubbornGirl') || (!legacy && state.cardRevision !== 2)) throw new TypeError('Invalid preset');
  const needs = exactRecord(state.needs, ['energy', 'attention', 'play', 'comfort', 'boredom']);
  const relationship = exactRecord(state.relationship, ['friendship', 'love', 'loveUnlocked']);
  const intimacy = exactRecord(state.intimacy, ['flirtiness', 'romanticCharge', 'userConsentEnabled', 'boundariesKnown']);
  const currentAxes = exactRecord(state.currentAxes, axes);
  if (!state.preferences || typeof state.preferences !== 'object' || Array.isArray(state.preferences)) throw new TypeError('Invalid preferences');
  const preferences = exactRecord(state.preferences, Object.keys(state.preferences));
  if (Object.keys(preferences).length > 256) throw new TypeError('Invalid preferences');
  const restored: CharacterState = { ...defaults,
    needs: { energy: number(needs.energy), attention: number(needs.attention), play: number(needs.play), comfort: number(needs.comfort), boredom: number(needs.boredom) },
    relationship: { friendship: number(relationship.friendship), love: number(relationship.love), loveUnlocked: boolean(relationship.loveUnlocked) },
    intimacy: { flirtiness: number(intimacy.flirtiness), romanticCharge: number(intimacy.romanticCharge), userConsentEnabled: boolean(intimacy.userConsentEnabled), boundariesKnown: boolean(intimacy.boundariesKnown) },
    personality: { ...defaults.personality, axes: { ...defaults.personality.axes } },
    preferences: Object.fromEntries(Object.entries(preferences).map(([key, value]) => {
      if (!key.trim() || key.length > 128) throw new TypeError('Invalid preference key');
      const track = exactRecord(value, ['value', 'confidence', 'samples']);
      return [key, { value: number(track.value), confidence: number(track.confidence), samples: number(track.samples) }];
    })), lastUpdated: now,
  };
  for (const axis of axes) {
    const current = number(currentAxes[axis]);
    const [hardMin, hardMax] = legacy ? legacyHardCaps[axis] : [defaults.personality.axes[axis].hardMin, defaults.personality.axes[axis].hardMax];
    if (current < hardMin || current > hardMax) throw new TypeError('Invalid axis');
    restored.personality.axes[axis] = { ...defaults.personality.axes[axis], current: legacy ? defaults.personality.axes[axis].base : current };
  }
  if (!validDynamicCharacterState(restored)) throw new TypeError('Invalid character state');
  return restored;
}
