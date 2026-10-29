import {
  DEFAULT_AUTONOMOUS_INTENT_CONFIG,
  resolveAutonomousBehaviorIntent,
  type AutonomousCandidate,
  type AutonomousDecisionContext,
  type AutonomousIntentConfig,
  type IPrng,
} from '../behavior/autonomous-behavior';
import type { BehaviorIntent } from '../behavior/behavior-intent';
import { selectLocalActivity, type LocalSelectionContext, type LocalSelectionTrace } from '../behavior/local-activity-policy';
import type { CharacterState, Needs, PreferenceTrack, Relationship, SynthesizedEmotionalTone } from './types';
import { createCharacterSnapshot } from './character-snapshot';
import { validatedLocalPreference, type LearnedPreference } from './preferences';
import { validatedCursorGamePreference } from '../behavior/cursor-observe-policy';

export type SemanticSleepState = 'awake' | 'sleeping';

export interface CharacterAutonomySnapshot {
  readonly needs: Needs;
  /** P17-A04 local choice projection; numeric authority remains Character. */
  readonly learnedCursorGamePreference?: Readonly<Pick<PreferenceTrack, 'value' | 'confidence'>>;
  readonly learnedExplorePreference?: LearnedPreference;
  readonly learnedSocialBidPreference?: LearnedPreference;
  readonly localTraits?: { readonly openness: number; readonly playfulness: number; readonly independence: number; readonly extraversion: number };
  readonly synthesizedTone: SynthesizedEmotionalTone;
  readonly relationship?: Readonly<Pick<Relationship, 'friendship'>>;
}

/** Internal local projection; provider and IPC snapshots do not gain preference keys. */
export function createCharacterAutonomySnapshot(state: CharacterState): CharacterAutonomySnapshot {
  const axes = state.personality.axes;
  return { ...createCharacterSnapshot(state),
    learnedCursorGamePreference: validatedCursorGamePreference(state.preferences['activity.cursor_game']),
    learnedExplorePreference: validatedLocalPreference(state.preferences['activity.explore']),
    learnedSocialBidPreference: validatedLocalPreference(state.preferences['activity.social_bid']),
    localTraits: { openness: axes.openness.current, playfulness: axes.playfulness.current,
      independence: axes.independence.current, extraversion: axes.extraversion.current } };
}

export interface CharacterAutonomyResolution {
  readonly selectionTrace?: readonly LocalSelectionTrace[];
  readonly resolvedIntent: BehaviorIntent | null;
  readonly autonomyEligible: boolean;
  readonly semanticSleepState: SemanticSleepState;
}

const SLEEP_ENERGY_MAX = 20;
const SLEEP_COMFORT_MIN = 80;
export const WAKE_ATTENTION_MIN = 90;
const WAKE_ENERGY_MIN = 80;

export function requiresVitalSleep(snapshot: CharacterAutonomySnapshot): boolean {
  return snapshot.needs.energy <= SLEEP_ENERGY_MAX || snapshot.needs.comfort >= SLEEP_COMFORT_MIN;
}
export function permitsAutomaticWake(snapshot: CharacterAutonomySnapshot): boolean {
  return snapshot.needs.attention >= WAKE_ATTENTION_MIN || snapshot.needs.energy >= WAKE_ENERGY_MIN;
}
export function isQuietCompatible(intent: BehaviorIntent, quiet: boolean): boolean {
  return !quiet || intent.source === 'user' || !['play', 'respond', 'react_happy'].includes(intent.kind);
}

/** Character-owned semantic sleep state and autonomy-resolution transaction. */
export class AutonomyCharacterEngine {
  private sleepState: SemanticSleepState = 'awake';

  public constructor(private readonly onSleepStateChanged?: () => void) {}

  private setSleepState(state: SemanticSleepState): void {
    if (this.sleepState === state) return;
    this.sleepState = state;
    this.onSleepStateChanged?.();
  }

  public getSemanticSleepState(): SemanticSleepState {
    return this.sleepState;
  }

  public chatMotionRejection(snapshot: CharacterAutonomySnapshot): 'sleeping' | 'low_energy' | 'overloaded' | null {
    if (this.sleepState === 'sleeping') return 'sleeping';
    if (snapshot.needs.energy <= SLEEP_ENERGY_MAX) return 'low_energy';
    if (snapshot.needs.comfort >= SLEEP_COMFORT_MIN) return 'overloaded';
    return null;
  }

  public finishRest(): void { this.setSleepState('awake'); }

  public wakeForSupportLoss(): void {
    this.setSleepState('awake');
  }

  public isAutonomyEligible(): boolean {
    return this.sleepState === 'awake';
  }

  public resolveAutonomousOpportunity(input: {
    readonly context: AutonomousDecisionContext;
    readonly snapshot: CharacterAutonomySnapshot;
    readonly candidates: readonly AutonomousCandidate[];
    readonly prng: IPrng;
    readonly config?: AutonomousIntentConfig;
    readonly selection?: LocalSelectionContext;
  }): CharacterAutonomyResolution {
    if (this.sleepState === 'sleeping') return this.resolution(null);

    const vitalSleep = requiresVitalSleep(input.snapshot);
    const sleepCandidate = input.candidates.find((candidate) => candidate.kind === 'sleep');
    if (!vitalSleep && input.selection) {
      // Optional rest must survive the same Character wake gate used by the next Brain tick.
      const selection = selectLocalActivity(input.snapshot, {
        ...input.selection,
        canRest: input.selection.canRest && !permitsAutomaticWake(input.snapshot),
      }, input.prng.next());
      if (selection.intent.kind === 'sleep') this.setSleepState('sleeping');
      return { ...this.resolution(selection.intent), selectionTrace: selection.trace };
    }
    const resolvedIntent = vitalSleep
      ? sleepCandidate === undefined
        ? null
        : { ...sleepCandidate, reason: 'vital_sleep' }
      : resolveAutonomousBehaviorIntent(
          input.context,
          input.candidates,
          input.prng,
          input.config ?? DEFAULT_AUTONOMOUS_INTENT_CONFIG,
          input.snapshot.needs
        );

    if (resolvedIntent?.kind === 'sleep') this.setSleepState('sleeping');
    return this.resolution(resolvedIntent);
  }

  public resolveDirectIntent(
    intent: BehaviorIntent,
    snapshot: CharacterAutonomySnapshot
  ): CharacterAutonomyResolution {
    if (intent.kind === 'sleep' && intent.source === 'user' && this.sleepState === 'awake') {
      this.setSleepState('sleeping');
      return this.resolution(intent);
    }
    if (intent.kind === 'drag') {
      this.setSleepState('awake');
      return this.resolution(intent);
    }
    if (intent.kind === 'wander' && intent.source === 'user' && this.chatMotionRejection(snapshot) === null) return this.resolution(intent);
    if ((intent.kind === 'play' || intent.kind === 'think') && this.sleepState === 'awake'
        && !requiresVitalSleep(snapshot)) {
      return this.resolution(intent);
    }
    if (
      intent.kind === 'wake' &&
      this.sleepState === 'sleeping' &&
      (intent.source === 'user' ||
        snapshot.needs.attention >= WAKE_ATTENTION_MIN ||
        snapshot.needs.energy >= WAKE_ENERGY_MIN)
    ) {
      this.setSleepState('awake');
      return this.resolution(intent);
    }
    return this.resolution(null);
  }

  private resolution(resolvedIntent: BehaviorIntent | null): CharacterAutonomyResolution {
    return {
      resolvedIntent,
      autonomyEligible: this.isAutonomyEligible(),
      semanticSleepState: this.sleepState,
    };
  }

  public resolveProviderIntent(intent: BehaviorIntent, snapshot: CharacterAutonomySnapshot): BehaviorIntent | null {
    if (intent.source !== 'provider') return null;
    if (['wake', 'drag', 'land', 'quiet'].includes(intent.kind)) return null;
    if (this.sleepState !== 'awake') return null;
    if (intent.kind === 'sleep') {
      this.setSleepState('sleeping'); return intent;
    }
    if (requiresVitalSleep(snapshot)) return null;
    return intent;
  }
}
