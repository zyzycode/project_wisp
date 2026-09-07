import type { InitiativeBudgetSnapshot, InitiativeTuning } from '../ports/behavior-admission-port';
export const INITIATIVE_TUNING: InitiativeTuning = {
  version: 'AUTO-A09-v1', windowMs: 120000, maxEpisodesPerWindow: 2, minIntervalMs: 30000,
  cursorEpisodeMaxMs: 6000, cursorApproachMaxDistanceDip: 160, socialWaitMaxMs: 4000,
};
/** Shared session ledger; admission is free, only actual starts spend a token. */
export class InitiativeBudget {
  private state: InitiativeBudgetSnapshot = { windowStartedAtMs: 0, startedEpisodes: 0, nextEligibleAtMs: 0 };
  public constructor(private readonly tuning: InitiativeTuning = INITIATIVE_TUNING) {}
  public available(nowMs: number): boolean {
    if (!Number.isFinite(nowMs) || nowMs < this.state.windowStartedAtMs) return false;
    const freshWindow = nowMs - this.state.windowStartedAtMs >= this.tuning.windowMs;
    return nowMs >= this.state.nextEligibleAtMs && (freshWindow || this.state.startedEpisodes < this.tuning.maxEpisodesPerWindow);
  }
  public start(nowMs: number): boolean {
    if (!this.available(nowMs)) return false;
    const freshWindow = nowMs - this.state.windowStartedAtMs >= this.tuning.windowMs;
    this.state = { windowStartedAtMs: freshWindow ? nowMs : this.state.windowStartedAtMs,
      startedEpisodes: freshWindow ? 1 : this.state.startedEpisodes + 1,
      nextEligibleAtMs: nowMs + this.tuning.minIntervalMs };
    return true;
  }
  public getSnapshot(): InitiativeBudgetSnapshot { return { ...this.state }; }
}
