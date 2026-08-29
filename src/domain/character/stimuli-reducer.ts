import { DEFAULT_INTIMACY_THRESHOLDS } from './intimacy-rules';
import { adaptPersonalityAxes, type PersonalityAxisDeltas } from './personality-plasticity';
import { trackPreference } from './preferences';
import { synthesizeEmotionalTone } from './emotional-tone';
import { metabolizeNeeds } from './metabolism';
import type {
  CharacterState,
  IntimacyState,
  Needs,
  PreferenceTrack,
  Relationship,
  StimulusEvent,
  StimulusType,
  SynthesizedEmotionalTone,
} from './types';

export type CharacterStimulusType =
  | StimulusType
  | 'click'
  | 'user_click'
  | 'user_double_click'
  | 'user_right_click'
  | 'pet'
  | 'user_pet'
  | 'play'
  | 'feed'
  | 'chat_message'
  | 'user_message'
  | 'provider_response'
  | 'idle_tick'
  | 'topic_dialogue';

export interface CharacterStimulus {
  readonly id?: string;
  readonly type: CharacterStimulusType;
  readonly source?: StimulusEvent['source'];
  readonly createdAt?: string;
  readonly intensity?: number;
  readonly text?: string;
  readonly requestId?: string;
  readonly metadata?: Record<string, string | number | boolean | null>;
}

type NormalizedStimulusType =
  | 'click'
  | 'pet'
  | 'play'
  | 'feed'
  | 'chat_message'
  | 'idle_tick'
  | 'topic_dialogue'
  | 'other';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampNeed(value: number): number {
  return clamp(value, 0, 100);
}

function clampRelationship(value: number): number {
  return clamp(value, 0, 1000);
}

function normalizeIntensity(intensity: number | undefined): number {
  return clamp(intensity ?? 1, 0, 3);
}

function metadataNumber(stimulus: CharacterStimulus, key: string): number | undefined {
  const value = stimulus.metadata?.[key];
  return typeof value === 'number' ? value : undefined;
}

function metadataString(stimulus: CharacterStimulus, key: string): string | undefined {
  const value = stimulus.metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function metadataTone(stimulus: CharacterStimulus): SynthesizedEmotionalTone | undefined {
  const value = stimulus.metadata?.tone;

  if (
    value === 'shy' ||
    value === 'sleepy' ||
    value === 'playful' ||
    value === 'curious' ||
    value === 'neutral' ||
    value === 'affectionate' ||
    value === 'flustered'
  ) {
    return value;
  }

  return undefined;
}

function createdAtMs(stimulus: CharacterStimulus): number | undefined {
  if (stimulus.createdAt === undefined) {
    return undefined;
  }

  const parsed = Date.parse(stimulus.createdAt);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function deltaMsFor(state: CharacterState, stimulus: CharacterStimulus): number {
  const explicitDelta = metadataNumber(stimulus, 'deltaMs');

  if (explicitDelta !== undefined) {
    return Math.max(0, explicitDelta);
  }

  const timestamp = createdAtMs(stimulus);

  if (timestamp === undefined) {
    return 0;
  }

  return Math.max(0, timestamp - state.lastUpdated);
}

function lastUpdatedFor(state: CharacterState, stimulus: CharacterStimulus, deltaMs: number): number {
  return createdAtMs(stimulus) ?? state.lastUpdated + deltaMs;
}

function normalizeStimulusType(type: CharacterStimulusType): NormalizedStimulusType {
  switch (type) {
    case 'click':
    case 'user_click':
    case 'user_double_click':
    case 'user_right_click':
      return 'click';
    case 'pet':
    case 'user_pet':
      return 'pet';
    case 'play':
      return 'play';
    case 'feed':
      return 'feed';
    case 'chat_message':
    case 'user_message':
    case 'provider_response':
      return 'chat_message';
    case 'idle_tick':
    case 'timer_tick':
    case 'autonomous_timer':
      return 'idle_tick';
    case 'topic_dialogue':
      return 'topic_dialogue';
    case 'user_drag_start':
    case 'user_drag_end':
    case 'memory_recall':
    case 'settings_changed':
    case 'system_event':
      return 'other';
  }
}

function applyNeedShift(needs: Needs, shift: Partial<Needs>): Needs {
  return {
    energy: clampNeed(needs.energy + (shift.energy ?? 0)),
    attention: clampNeed(needs.attention + (shift.attention ?? 0)),
    play: clampNeed(needs.play + (shift.play ?? 0)),
    comfort: clampNeed(needs.comfort + (shift.comfort ?? 0)),
    boredom: clampNeed((needs.boredom ?? 15) + (shift.boredom ?? 0)),
  };
}

function progressRelationship(
  relationship: Relationship,
  friendshipDelta: number,
  loveDelta: number
): Relationship {
  const friendship = clampRelationship(relationship.friendship + Math.max(0, friendshipDelta));
  const loveUnlocked =
    relationship.loveUnlocked ||
    friendship >= DEFAULT_INTIMACY_THRESHOLDS.LOVE_UNLOCK_FRIENDSHIP_THRESHOLD;
  const love = loveUnlocked ? clampRelationship(relationship.love + Math.max(0, loveDelta)) : relationship.love;

  return {
    friendship,
    love,
    loveUnlocked,
  };
}

function applyIntimacyShift(intimacy: IntimacyState, shift: Partial<IntimacyState>): IntimacyState {
  return {
    flirtiness: clamp(intimacy.flirtiness + (shift.flirtiness ?? 0), 0, 100),
    romanticCharge: clamp(intimacy.romanticCharge + (shift.romanticCharge ?? 0), 0, 100),
    userConsentEnabled: shift.userConsentEnabled ?? intimacy.userConsentEnabled,
    boundariesKnown: shift.boundariesKnown ?? intimacy.boundariesKnown,
  };
}

function preferenceKeyFor(stimulus: CharacterStimulus): string | undefined {
  return (
    metadataString(stimulus, 'preferenceKey') ??
    metadataString(stimulus, 'topicKey') ??
    metadataString(stimulus, 'topic')
  );
}

function preferenceValueFor(stimulus: CharacterStimulus): number {
  return metadataNumber(stimulus, 'preferenceValue') ?? metadataNumber(stimulus, 'affinity') ?? 0;
}

function nextPreferencesFor(
  preferences: Record<string, PreferenceTrack>,
  stimulus: CharacterStimulus,
  intensity: number
): Record<string, PreferenceTrack> {
  const key = preferenceKeyFor(stimulus);

  if (key === undefined) {
    return { ...preferences };
  }

  return trackPreference(preferences, key, preferenceValueFor(stimulus), intensity);
}

function interactionDeltas(
  type: NormalizedStimulusType,
  intensity: number
): {
  readonly needs: Partial<Needs>;
  readonly friendship: number;
  readonly love: number;
  readonly intimacy: Partial<IntimacyState>;
  readonly personality: PersonalityAxisDeltas;
} {
  switch (type) {
    case 'click':
      return {
        needs: {
          attention: -4 * intensity,
          play: -2 * intensity,
          energy: -0.4 * intensity,
          boredom: -6 * intensity,
        },
        friendship: 1 * intensity,
        love: 0,
        intimacy: {},
        personality: { extraversion: 0.002 * intensity, playfulness: 0.002 * intensity },
      };
    case 'pet':
      return {
        needs: {
          attention: -9 * intensity,
          comfort: -6 * intensity,
          energy: -0.6 * intensity,
          boredom: -5 * intensity,
        },
        friendship: 4 * intensity,
        love: 2 * intensity,
        intimacy: { romanticCharge: 1.5 * intensity },
        personality: { agreeableness: 0.002 * intensity, sensitivity: -0.001 * intensity },
      };
    case 'play':
      return {
        needs: {
          attention: -3 * intensity,
          play: -15 * intensity,
          energy: -3 * intensity,
          boredom: -18 * intensity,
        },
        friendship: 3 * intensity,
        love: 0,
        intimacy: {},
        personality: { extraversion: 0.003 * intensity, playfulness: 0.004 * intensity },
      };
    case 'feed':
      return {
        needs: {
          energy: 6 * intensity,
          comfort: -4 * intensity,
          boredom: -2 * intensity,
        },
        friendship: 2 * intensity,
        love: 0,
        intimacy: {},
        personality: { agreeableness: 0.001 * intensity },
      };
    case 'chat_message':
      return {
        needs: {
          attention: -12 * intensity,
          play: -4 * intensity,
          comfort: -1 * intensity,
          boredom: -12 * intensity,
        },
        friendship: 6 * intensity,
        love: 1 * intensity,
        intimacy: { flirtiness: -0.5 * intensity },
        personality: { extraversion: 0.003 * intensity, agreeableness: 0.001 * intensity },
      };
    case 'topic_dialogue':
      return {
        needs: {
          attention: -8 * intensity,
          play: -7 * intensity,
          comfort: -1 * intensity,
          boredom: -15 * intensity,
        },
        friendship: 8 * intensity,
        love: 2 * intensity,
        intimacy: { romanticCharge: 0.8 * intensity },
        personality: { openness: 0.004 * intensity, playfulness: 0.002 * intensity },
      };
    case 'idle_tick':
    case 'other':
      return {
        needs: {},
        friendship: 0,
        love: 0,
        intimacy: {},
        personality: {},
      };
  }
}

export function processStimulus(state: CharacterState, stimulus: CharacterStimulus): CharacterState {
  const normalizedType = normalizeStimulusType(stimulus.type);
  const intensity = normalizeIntensity(stimulus.intensity);
  const deltaMs = deltaMsFor(state, stimulus);
  const lastUpdated = lastUpdatedFor(state, stimulus, deltaMs);
  const tone = metadataTone(stimulus) ?? synthesizeEmotionalTone(state);
  const metabolizedNeeds = metabolizeNeeds(state.needs, deltaMs, tone);
  const deltas = interactionDeltas(normalizedType, intensity);
  const relationship = progressRelationship(state.relationship, deltas.friendship, deltas.love);
  const intimacy = applyIntimacyShift(state.intimacy, deltas.intimacy);
  const preferences =
    normalizedType === 'topic_dialogue'
      ? nextPreferencesFor(state.preferences, stimulus, intensity)
      : { ...state.preferences };

  return {
    needs: applyNeedShift(metabolizedNeeds, deltas.needs),
    relationship,
    personality: {
      ...state.personality,
      axes: adaptPersonalityAxes(state.personality.axes, deltas.personality),
    },
    intimacy,
    preferences,
    lastUpdated,
  };
}
