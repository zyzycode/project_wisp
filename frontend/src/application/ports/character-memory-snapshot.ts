import type { PersonalityAxis } from '../../domain/character/types';

/** Frozen legacy projection, accepted only by the one-way restore migration.
 * Runtime validation and restore mapping belong to Application/Domain, not SQLite.
 */
export type CharacterMemoryStateV1 = {
  readonly presetId: 'shyDreamGirl';
  readonly needs: {
    readonly energy: number;
    readonly attention: number;
    readonly play: number;
    readonly comfort: number;
    readonly boredom: number;
  };
  readonly relationship: {
    readonly friendship: number;
    readonly love: number;
    readonly loveUnlocked: boolean;
  };
  readonly intimacy: {
    readonly flirtiness: number;
    readonly romanticCharge: number;
    readonly userConsentEnabled: boolean;
    readonly boundariesKnown: boolean;
  };
  readonly currentAxes: Readonly<Record<PersonalityAxis, number>>;
  readonly preferences: {
    readonly [key: string]: {
      readonly value: number;
      readonly confidence: number;
      readonly samples: number;
    };
  };
};

export type CharacterMemorySnapshotV1 = {
  readonly snapshotVersion: 1;
  readonly state: CharacterMemoryStateV1;
  readonly updatedAt: string;
};

/** Active persisted dynamic projection; authored identity/caps stay in Domain. */
export type CharacterMemoryStateV2 = Omit<CharacterMemoryStateV1, 'presetId'> & {
  readonly presetId: 'curiousStubbornGirl';
  readonly cardRevision: 2;
};

export type CharacterMemorySnapshotV2 = {
  readonly snapshotVersion: 2;
  readonly state: CharacterMemoryStateV2;
  readonly updatedAt: string;
};
