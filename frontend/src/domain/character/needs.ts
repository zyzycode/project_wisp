/**
 * Needs and Vitality Domain Model
 */

export interface Needs {
  readonly energy: number;
  readonly attention: number;
  readonly play: number;
  readonly comfort: number;
  readonly boredom?: number;
  readonly [key: string]: any;
}

export const DEFAULT_INITIAL_NEEDS: Needs = {
  energy: 85,
  attention: 20,
  play: 20,
  comfort: 15,
  boredom: 15,
};

export function clampNeed(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

export function createNeeds(partial: Partial<Needs> = {}): Needs {
  return {
    energy: clampNeed(partial.energy ?? DEFAULT_INITIAL_NEEDS.energy),
    attention: clampNeed(partial.attention ?? DEFAULT_INITIAL_NEEDS.attention),
    play: clampNeed(partial.play ?? DEFAULT_INITIAL_NEEDS.play),
    comfort: clampNeed(partial.comfort ?? DEFAULT_INITIAL_NEEDS.comfort),
    boredom: clampNeed(partial.boredom ?? DEFAULT_INITIAL_NEEDS.boredom ?? 15),
  };
}
