/** SOC-A01-v1: session-only state; time, gates and randomness are explicit inputs. */
export const SOCIAL_FOLLOWUP_TUNING = { version: 'SOC-A01-v1', delayMs: 30_000, expiryMs: 60_000,
  chance: 1 / 3, gestureMs: 1200, waitMs: 4000 } as const;

export interface SocialFollowupTicket { readonly chainId: number; readonly generation: number; }
interface Chain extends SocialFollowupTicket {
  readonly firstRunId: string;
  readonly completedAtMs: number | null;
  readonly consumed: boolean;
  readonly secondRunId: string | null;
}

export class SocialBidFollowupPolicy {
  private generation = 0;
  private sequence = 0;
  private latched = false;
  private chain: Chain | null = null;

  public canStartFirst(): boolean { return !this.latched; }
  public firstStarted(runId: string): void {
    if (this.latched) return;
    this.latched = true;
    this.chain = { chainId: ++this.sequence, generation: this.generation, firstRunId: runId,
      completedAtMs: null, consumed: false, secondRunId: null };
  }
  public terminal(runId: string, status: 'completed' | 'cancelled' | 'failed', atMs: number): void {
    const chain = this.chain;
    if (!chain || chain.generation !== this.generation) return;
    if (runId === chain.secondRunId) { this.chain = null; return; }
    if (runId !== chain.firstRunId || chain.completedAtMs !== null || chain.consumed) return;
    this.chain = status === 'completed' && Number.isFinite(atMs)
      ? { ...chain, completedAtMs: atMs } : null;
  }
  /** Cancellation never releases the silence latch. */
  public invalidate(): void { this.generation++; this.chain = null; }
  public contact(): void { this.invalidate(); this.latched = false; }
  public reset(): void { this.contact(); }

  public evaluate(nowMs: number, continuityAllowed: boolean, startAllowed: boolean,
    nextRandom: () => number): SocialFollowupTicket | null {
    const chain = this.chain;
    if (!chain) return null;
    if (!continuityAllowed || !Number.isFinite(nowMs)) { this.invalidate(); return null; }
    if (chain.completedAtMs === null || chain.consumed) return null;
    const elapsed = nowMs - chain.completedAtMs;
    if (elapsed < 0 || elapsed >= SOCIAL_FOLLOWUP_TUNING.expiryMs) { this.invalidate(); return null; }
    if (elapsed < SOCIAL_FOLLOWUP_TUNING.delayMs) return null;
    this.chain = { ...chain, consumed: true };
    if (!startAllowed) return null;
    const draw = nextRandom();
    return Number.isFinite(draw) && draw >= 0 && draw < SOCIAL_FOLLOWUP_TUNING.chance
      ? { chainId: chain.chainId, generation: chain.generation } : null;
  }
  public isCurrent(ticket: SocialFollowupTicket, nowMs: number): boolean {
    const chain = this.chain;
    return chain !== null && chain.chainId === ticket.chainId && chain.generation === ticket.generation
      && chain.completedAtMs !== null && chain.consumed && chain.secondRunId === null
      && nowMs >= chain.completedAtMs + SOCIAL_FOLLOWUP_TUNING.delayMs
      && nowMs < chain.completedAtMs + SOCIAL_FOLLOWUP_TUNING.expiryMs;
  }
  public secondStarted(ticket: SocialFollowupTicket, runId: string, nowMs: number): void {
    if (this.isCurrent(ticket, nowMs) && this.chain) this.chain = { ...this.chain, secondRunId: runId };
  }
}
