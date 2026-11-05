/** Tuning for the existing ActivityRunner; this module does not execute or persist a session. */
export const BOOK_SESSION_TUNING = {
  version: 'book-session-v1', settleMs: 1200, withBookMs: 12_000, finishMs: 800,
  minimumCompletedMs: 14_000, deadlineMs: 16_000, cooldownMs: 30_000,
} as const;

export interface BookActivityEligibility {
  readonly canBook: boolean;
  readonly awake: boolean;
  readonly energy: number;
  readonly boredom: number;
  readonly comfort: number;
  readonly quiet: boolean;
  readonly supportMode: boolean;
  readonly menuOpen: boolean;
  readonly forcedMotion: boolean;
  readonly criticalNeed: boolean;
  readonly activeOwner: boolean;
  /** Fresh current floor/window-top support, verified with existing sit/collision geometry. */
  readonly stableSupport: boolean;
  readonly cooldownReady: boolean;
}

function validNeed(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

export function isBookActivityEligible(gates: BookActivityEligibility): boolean {
  return gates.canBook && gates.awake && gates.stableSupport && gates.cooldownReady
    && !gates.quiet && !gates.supportMode && !gates.menuOpen && !gates.forcedMotion
    && !gates.criticalNeed && !gates.activeOwner
    && [gates.energy, gates.boredom, gates.comfort].every(validNeed)
    && gates.energy >= 35 && gates.boredom >= 30 && gates.comfort <= 70;
}

/** No provider or user command may start the local-only candidate. */
export function isLocalBookAdmission(source: string, reason: string | undefined): boolean {
  return source === 'timer' && reason === 'local_utility';
}

export function bookSatiationMultiplier(satiation: number | undefined): number {
  return 1 - .75 * (satiation !== undefined && Number.isFinite(satiation) ? Math.max(0, Math.min(1, satiation)) : 0);
}

/** No user preference, repetition, goal, plan, coping, habit or emotion factor is applied. */
export function scoreBookActivity(gates: BookActivityEligibility, openness: number | undefined,
  ownInterestMultiplier: number | undefined, satiation: number | undefined): number {
  if (!isBookActivityEligible(gates)) return 0;
  const trait = openness !== undefined && Number.isFinite(openness) && openness >= 0 && openness <= 1 ? openness : .5;
  const own = ownInterestMultiplier !== undefined && Number.isFinite(ownInterestMultiplier)
    ? Math.max(.8, Math.min(1.2, ownInterestMultiplier)) : 1;
  return (.2 + gates.boredom / 30) * (.5 + trait) * own * bookSatiationMultiplier(satiation);
}

/** Evaluate before runner.tick: reaching the deadline must never become completion. */
export function isBookDeadlineReached(startedAtMs: number, nowMs: number): boolean {
  return !Number.isFinite(startedAtMs) || startedAtMs < 0 || !Number.isFinite(nowMs)
    || nowMs < startedAtMs || nowMs - startedAtMs >= BOOK_SESSION_TUNING.deadlineMs;
}
