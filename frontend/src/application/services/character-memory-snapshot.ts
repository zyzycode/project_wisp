import type { CharacterState, PersonalityAxis } from '../../domain/character';
import type { CausalSourceReference } from '../../domain/character/types';
import { createRelationship, RELATIONSHIP_FACET_KEYS } from '../../domain/character/relationship-facets';
import { validDynamicCharacterState } from '../../domain/character/state-validation';
import type { CharacterMemorySnapshotV3 } from '../ports/causal-life.interface';
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
function sourceReferences(value: unknown): readonly CausalSourceReference[] {
  if (!Array.isArray(value) || value.length > 20) throw new TypeError('Invalid causal sources');
  const seen = new Set<string>();
  return value.map(item => {
    const ref = exactRecord(item, ['appRunId', 'sequence', 'revision']);
    if (typeof ref.appRunId !== 'string' || !ref.appRunId.trim() || ref.appRunId.length > 128 || ref.revision !== 1
        || typeof ref.sequence !== 'number' || !Number.isSafeInteger(ref.sequence) || ref.sequence < 1) throw new TypeError('Invalid causal source');
    const key = JSON.stringify([ref.appRunId, ref.sequence]);
    if (seen.has(key)) throw new TypeError('Duplicate causal source');
    seen.add(key);
    return { appRunId: ref.appRunId, sequence: ref.sequence, revision: 1 };
  });
}
export function projectCharacterMemory(state: CharacterState, updatedAt: string): CharacterMemorySnapshotV3 {
  if (state.personality.id !== 'curiousStubbornGirl') throw new TypeError('Invalid active preset');
  if (!validDynamicCharacterState(state)) throw new TypeError('Invalid character state');
  const a = state.personality.axes;
  return { snapshotVersion: 3, updatedAt, state: {
    presetId: 'curiousStubbornGirl', cardRevision: 3,
    needs: { energy: state.needs.energy, attention: state.needs.attention, play: state.needs.play, comfort: state.needs.comfort, boredom: state.needs.boredom ?? 15 },
    relationship: { ...state.relationship }, intimacy: { ...state.intimacy },
    currentAxes: { openness: a.openness.current, extraversion: a.extraversion.current, agreeableness: a.agreeableness.current, sensitivity: a.sensitivity.current, playfulness: a.playfulness.current, boldness: a.boldness.current, independence: a.independence.current },
    preferences: Object.fromEntries(Object.entries(state.preferences).map(([key, value]) => [key, { ...value }])),
    ownGameInterestSources: sourceReferences(state.ownGameInterestSources),
  } };
}
export function restoreCharacterMemory(snapshot: PersistedCharacterStateSnapshot, defaults: CharacterState, now: number): CharacterState {
  const legacy = snapshot.snapshotVersion === 1;
  const current = snapshot.snapshotVersion === 3;
  if (!legacy && !current && snapshot.snapshotVersion !== 2) throw new TypeError('Unsupported snapshot');
  const state = exactRecord(snapshot.state, ['presetId', 'needs', 'relationship', 'intimacy', 'currentAxes', 'preferences', ...(legacy ? [] : ['cardRevision']), ...(current ? ['ownGameInterestSources'] : [])]);
  if (state.presetId !== (legacy ? 'shyDreamGirl' : 'curiousStubbornGirl') || (!legacy && state.cardRevision !== 2 && state.cardRevision !== 3)) throw new TypeError('Invalid preset');
  const needs = exactRecord(state.needs, ['energy', 'attention', 'play', 'comfort', 'boredom']);
  if (current && state.cardRevision !== 3) throw new TypeError('Invalid card revision');
  const relationship = exactRecord(state.relationship, ['friendship', 'love', 'loveUnlocked', ...(current ? RELATIONSHIP_FACET_KEYS : [])]);
  const intimacy = exactRecord(state.intimacy, ['flirtiness', 'romanticCharge', 'userConsentEnabled', 'boundariesKnown']);
  const currentAxes = exactRecord(state.currentAxes, axes);
  if (!state.preferences || typeof state.preferences !== 'object' || Array.isArray(state.preferences)) throw new TypeError('Invalid preferences');
  const preferences = exactRecord(state.preferences, Object.keys(state.preferences));
  if (Object.keys(preferences).length > 256) throw new TypeError('Invalid preferences');
  const restored: CharacterState = { ...defaults,
    needs: { energy: number(needs.energy), attention: number(needs.attention), play: number(needs.play), comfort: number(needs.comfort), boredom: number(needs.boredom) },
    relationship: { ...createRelationship({ friendship: number(relationship.friendship), love: number(relationship.love), loveUnlocked: boolean(relationship.loveUnlocked) }),
      ...(current ? { familiarity: number(relationship.familiarity), affection: number(relationship.affection), trust: number(relationship.trust), respect: number(relationship.respect), resentment: number(relationship.resentment), comfort: number(relationship.comfort) } : {}) },
    intimacy: { flirtiness: number(intimacy.flirtiness), romanticCharge: number(intimacy.romanticCharge), userConsentEnabled: boolean(intimacy.userConsentEnabled), boundariesKnown: boolean(intimacy.boundariesKnown) },
    personality: { ...defaults.personality, axes: { ...defaults.personality.axes } },
    preferences: Object.fromEntries(Object.entries(preferences).map(([key, value]) => {
      if (!key.trim() || key.length > 128) throw new TypeError('Invalid preference key');
      const track = exactRecord(value, ['value', 'confidence', 'samples']);
      return [key, { value: number(track.value), confidence: number(track.confidence), samples: number(track.samples) }];
    })), ownGameInterestSources: current ? sourceReferences(state.ownGameInterestSources) : [], lastUpdated: now,
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
