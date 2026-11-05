import type { CausalLifeEpisode, DeferredGameInvitation, ICausalLifeCommitObserver, IDeferredGameInvitationRepository } from '../ports/causal-life.interface';
import type { MemoryOperationContext } from '../ports/memory-repository.interface';
import { invitationSourceEligible, invitationTimeState, invitationWindow } from '../../domain/behavior/deferred-game-invitation';

interface ObservedSource { readonly generation: number; readonly appRunId: string; readonly sequence: number; readonly firstSequence: number; }
interface Options {
  readonly repository: IDeferredGameInvitationRepository;
  readonly context: () => MemoryOperationContext | null;
  readonly wallNow: () => number;
  readonly monotonicNow: () => number;
  readonly creationAllowed?: () => boolean;
  readonly createId: () => string;
  readonly eligible: () => boolean;
  readonly start: () => string | null;
  /** Re-arm the existing cadence after an asynchronous failed admission. */
  readonly onOpportunityFinished: () => void;
}
/** One durable opportunity; this class owns no timer, executor or initiative budget. */
export class DeferredGameInvitationRuntime implements ICausalLifeCommitObserver {
  private serial = 0;
  private cancellationEpoch = 0;
  private loaded = false;
  private claiming = false;
  private disposed = false;
  private invitation: DeferredGameInvitation | null = null;
  private inFlight = false;
  private starting = false;
  private activeRunId: string | null = null;
  private lastSeenWallMs = -Infinity;
  private sourceGeneration = -1;
  private sourceAppRunId: string | null = null;
  private sourceSequence = 0;
  private observedSource: ObservedSource | null = null;
  private cancelledThrough: { readonly generation: number; readonly atMs: number; readonly source: ObservedSource | null } | null = null;
  constructor(private readonly options: Options) {}
  observed(episode: CausalLifeEpisode, atMs: number): void {
    const context = this.options.context();
    if (!context || this.disposed || !Number.isFinite(atMs)) return;
    if (this.observedSource?.generation !== context.generation || this.observedSource.appRunId !== episode.appRunId) {
      this.observedSource = { generation: context.generation,appRunId: episode.appRunId,sequence: episode.sequence,firstSequence: episode.sequence };
    } else if (episode.sequence > this.observedSource.sequence) this.observedSource = { ...this.observedSource,sequence: episode.sequence };
  }
  committed(episode: CausalLifeEpisode, context: MemoryOperationContext, atMs: number): void {
    if (!this.current(context) || this.options.creationAllowed?.() === false || !Number.isFinite(atMs)
        || !invitationSourceEligible(episode,this.options.wallNow())) return;
    const observed = this.observedSource;
    if (!observed || observed.generation !== context.generation || observed.appRunId !== episode.appRunId
        || episode.sequence < observed.firstSequence || episode.sequence > observed.sequence) return;
    const cutoff = this.cancelledThrough;
    if (cutoff?.generation === context.generation && (atMs < cutoff.atMs
        || (cutoff.source?.appRunId === episode.appRunId && episode.sequence <= cutoff.source.sequence))) return;
    if (this.sourceGeneration !== context.generation) {
      this.sourceGeneration = context.generation; this.sourceAppRunId = episode.appRunId; this.sourceSequence = 0;
    }
    if (episode.appRunId !== this.sourceAppRunId || episode.sequence <= this.sourceSequence) return;
    this.sourceSequence = episode.sequence;
    const invite: DeferredGameInvitation = { id: this.options.createId(), sourceAppRunId: episode.appRunId,
      sourceSequence: episode.sequence, createdAt: episode.occurredAt, ...invitationWindow(episode.occurredAt), state: 'pending' };
    const cancellationEpoch = this.cancellationEpoch;
    void this.options.repository.create(invite,context).then(result => {
      if (!this.current(context) || !result.ok) return;
      if (cancellationEpoch !== this.cancellationEpoch) {
        void this.options.repository.finish(invite.id,'cancelled',context).catch(() => {}); return;
      }
      if (!this.invitation) void this.restore();
    }).catch(() => {});
  }
  async restore(): Promise<void> {
    const context = this.options.context();
    if (!context || this.disposed || this.inFlight || this.activeRunId) return;
    const serial = ++this.serial, now = this.options.wallNow();
    if (!Number.isFinite(now)) return;
    this.inFlight = true;
    try {
      const result = await this.options.repository.read(new Date(now).toISOString(),context);
      if (this.current(context) && serial === this.serial) {
        this.loaded = result.ok;
        this.invitation = result.ok && result.value?.state === 'pending' ? result.value : null;
        this.lastSeenWallMs = now;
      }
    } catch { /* Storage failure is an omission, never a volatile promise. */ }
    finally { if (serial === this.serial) this.inFlight = false; }
  }
  /** True reserves only this P4 opportunity while worker claim is pending. */
  opportunity(): boolean {
    const invite = this.invitation, context = this.options.context(), now = this.options.wallNow();
    if (!invite || !context || this.disposed || this.inFlight || this.activeRunId) return false;
    const timeState = invitationTimeState(invite,now,this.lastSeenWallMs);
    if (timeState === 'cancelled' || timeState === 'expired') { void this.cancel(timeState); return false; }
    this.lastSeenWallMs = now;
    if (timeState !== 'ready' || !this.options.eligible()) return false;
    const serial = ++this.serial;
    this.inFlight = true; this.claiming = true;
    void this.claim(invite,context,serial,now);
    return true;
  }
  /** Any unrelated actual start invalidates an outstanding claim, without blocking it. */
  activityStarted(runId: string): void {
    if (this.starting) { this.activeRunId = runId; return; }
    this.invalidateAdmission();
  }
  invalidateAdmission(): void {
    if (!this.claiming) return;
    this.serial++; this.inFlight = false; this.claiming = false; this.invitation = null;
    if (!this.disposed) this.options.onOpportunityFinished();
  }
  terminal(runId: string, completed: boolean): void {
    if (runId !== this.activeRunId) return;
    this.activeRunId = null;
    void this.cancel(completed ? 'completed' : 'cancelled');
  }
  hasPending(): boolean { return this.invitation !== null || this.activeRunId !== null; }
  invalidate(): void {
    const interruptedClaim = this.inFlight;
    this.serial++; this.inFlight = false; this.claiming = false; this.loaded = false; this.invitation = null; this.activeRunId = null;
    if (interruptedClaim && !this.disposed) this.options.onOpportunityFinished();
  }
  async cancel(state: 'completed' | 'cancelled' | 'expired' | 'abandoned' = 'cancelled'): Promise<void> {
    let invite = this.invitation;
    const context = this.options.context(), loaded = this.loaded, cancellationEpoch = ++this.cancellationEpoch;
    if (context) this.cancelledThrough = { generation: context.generation,atMs: this.options.monotonicNow(),source: this.observedSource };
    this.invalidate();
    if (!context) return;
    try {
      if (!invite && !loaded && state === 'cancelled') {
        const result = await this.options.repository.read(new Date(this.options.wallNow()).toISOString(),context);
        if (!this.current(context) || cancellationEpoch !== this.cancellationEpoch) return;
        invite = result.ok && result.value?.state === 'pending' ? result.value : null;
      }
      if (invite) await this.options.repository.finish(invite.id,state,context);
      if (cancellationEpoch === this.cancellationEpoch) this.loaded = true;
    } catch { /* No retry or callback restoration. */ }
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    const claimed = this.activeRunId !== null || this.claiming;
    this.disposed = true;
    if (claimed) await this.cancel('abandoned'); else this.invalidate();
  }
  private current(context: MemoryOperationContext): boolean {
    return !this.disposed && this.options.context()?.generation === context.generation;
  }
  private async claim(invite: DeferredGameInvitation, context: MemoryOperationContext, serial: number, now: number): Promise<void> {
    let started = false;
    try {
      const result = await this.options.repository.claim(invite.id,new Date(now).toISOString(),context);
      if (!result.ok || !result.value) { if (this.current(context) && serial === this.serial) this.invitation = null; return; }
      if (!this.current(context) || serial !== this.serial || !this.options.eligible()
          || invitationTimeState(invite,this.options.wallNow(),this.lastSeenWallMs) !== 'ready') {
        if (this.invitation?.id === invite.id) this.invitation = null;
        await this.options.repository.finish(invite.id,'abandoned',context); return;
      }
      this.invitation = { ...invite,state: 'claimed' };
      this.starting = true;
      let runId: string | null;
      try { runId = this.options.start(); } finally { this.starting = false; }
      if (runId && serial === this.serial && this.current(context)) { this.activeRunId = runId; started = true; }
      else { this.activeRunId = null; this.invitation = null; await this.options.repository.finish(invite.id,'abandoned',context); }
    } catch { if (this.current(context) && serial === this.serial) this.invitation = null; }
    finally {
      if (serial === this.serial) { this.inFlight = false; this.claiming = false; if (!started && !this.disposed) this.options.onOpportunityFinished(); }
    }
  }
}
