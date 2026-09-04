import {
  DEFAULT_AUTONOMOUS_INTENT_CONFIG,
  resolveAutonomousBehaviorIntent,
  type AutonomousCandidate,
  type AutonomousDecisionContext,
  type AutonomousIntentConfig,
  type IPrng,
} from '../behavior/autonomous-behavior';
import type { BehaviorIntent } from '../behavior/behavior-intent';
import type { Needs, SynthesizedEmotionalTone } from './types';

export type SemanticSleepState = 'awake' | 'sleeping';

export interface CharacterAutonomySnapshot {
  readonly needs: Needs;
  readonly synthesizedTone: SynthesizedEmotionalTone;
}

export interface CharacterAutonomyResolution {
  readonly resolvedIntent: BehaviorIntent | null;
  readonly autonomyEligible: boolean;
  readonly semanticSleepState: SemanticSleepState;
}

const SLEEP_ENERGY_MAX = 20;
const SLEEP_COMFORT_MIN = 80;
const WAKE_ATTENTION_MIN = 90;
const WAKE_ENERGY_MIN = 80;

/** Character-owned semantic sleep state and autonomy-resolution transaction. */
export class AutonomyCharacterEngine {
  private sleepState: SemanticSleepState = 'awake';

  public getSemanticSleepState(): SemanticSleepState {
    return this.sleepState;
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
  }): CharacterAutonomyResolution {
    if (this.sleepState === 'sleeping') return this.resolution(null);

    const { needs } = input.snapshot;
    const vitalSleep = needs.energy <= SLEEP_ENERGY_MAX || needs.comfort >= SLEEP_COMFORT_MIN;
    const sleepCandidate = input.candidates.find((candidate) => candidate.kind === 'sleep');
    const resolvedIntent = vitalSleep
      ? sleepCandidate === undefined
        ? null
        : { ...sleepCandidate, reason: 'vital_sleep' }
      : resolveAutonomousBehaviorIntent(
          input.context,
          input.candidates,
          input.prng,
          input.config ?? DEFAULT_AUTONOMOUS_INTENT_CONFIG
        );

    if (resolvedIntent?.kind === 'sleep') this.sleepState = 'sleeping';
    return this.resolution(resolvedIntent);
  }

  public resolveDirectIntent(
    intent: BehaviorIntent,
    snapshot: CharacterAutonomySnapshot
  ): CharacterAutonomyResolution {
    if (intent.kind === 'sleep' && intent.source === 'user' && this.sleepState === 'awake') {
      this.sleepState = 'sleeping';
      return this.resolution(intent);
    }
    if (intent.kind === 'drag') {
      this.sleepState = 'awake';
      return this.resolution(intent);
    }
    if (
      intent.kind === 'wake' &&
      this.sleepState === 'sleeping' &&
      (intent.source === 'user' ||
        snapshot.needs.attention >= WAKE_ATTENTION_MIN ||
        snapshot.needs.energy >= WAKE_ENERGY_MIN)
    ) {
      this.sleepState = 'awake';
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
}
