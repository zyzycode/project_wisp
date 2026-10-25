import type { SystemIdleLifecycleEvent, SystemIdlePort, SystemIdleReading } from '../application/ports/system-idle.port';
import { createSystemIdleState, systemPresenceAt, updateSystemIdle } from '../domain/behavior/system-idle-policy';

/** Session-only sampling owner; the existing Brain tick is the only read cadence. */
export class MainSystemIdle {
  private generation = 0;
  private sequence = 0;
  private state = createSystemIdleState(this.generation);
  private lastReadAt: number | null = null;
  private enabled = true;
  private suspended = false;
  private inactiveSession = false;
  private locked = false;
  private disposed = false;
  private unsubscribe: (() => void) | undefined;
  constructor(private readonly options: {
    readonly source?: SystemIdlePort;
    readonly now: () => number;
    readonly wallNow: () => number;
    readonly onBlocked: () => void;
  }) { this.subscribe(); }

  public isBlocked(): boolean {
    return !this.disposed && (this.suspended || this.inactiveSession || this.locked
      || systemPresenceAt(this.state, this.options.now()) === 'probably_away');
  }

  public reset(): void {
    this.generation++; this.state = createSystemIdleState(this.generation);
    this.unsubscribe?.(); this.subscribe();
  }

  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled; this.reset();
  }

  public tick(armingAllowed: boolean): boolean {
    if (this.disposed || !this.enabled || this.suspended || this.inactiveSession || !this.options.source) return false;
    const nowMs = this.options.now();
    if (!Number.isFinite(nowMs) || (this.lastReadAt !== null && nowMs < this.lastReadAt)) {
      this.reset(); this.lastReadAt = Number.isFinite(nowMs) ? nowMs : null; return false;
    }
    if (this.lastReadAt !== null && nowMs - this.lastReadAt < 1000) return false;
    this.lastReadAt = nowMs;
    const wasBlocked = this.isBlocked();
    let reading: SystemIdleReading;
    try { reading = this.options.source.read(); } catch { reading = { status: 'unavailable', reason: 'read_failed' }; }
    const locked = reading.status === 'available' || reading.reason === 'unconfirmed' ? false
      : reading.reason === 'inactive_session' || this.locked;
    if (this.locked !== locked || (reading.status === 'unavailable' && reading.reason !== 'unconfirmed')) this.reset();
    this.locked = locked;
    const update = updateSystemIdle(this.state, { generation: this.generation, sequence: ++this.sequence,
      nowMs, wallNowMs: this.options.wallNow(), idleMs: reading.status === 'available' ? reading.idleMs : null,
      unconfirmed: reading.status === 'unavailable' && reading.reason === 'unconfirmed', armingAllowed });
    this.state = update.state;
    if (!wasBlocked && this.isBlocked()) this.options.onBlocked();
    return update.returned;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.generation++; this.state = createSystemIdleState(this.generation);
    this.unsubscribe?.(); this.unsubscribe = undefined; this.options.source?.dispose();
  }

  private subscribe(): void {
    if (this.disposed) return;
    const generation = this.generation;
    this.unsubscribe = this.options.source?.subscribeLifecycle(event => {
      if (this.disposed || generation !== this.generation) return;
      this.onLifecycle(event);
    });
  }

  private onLifecycle(event: SystemIdleLifecycleEvent): void {
    const wasBlocked = this.isBlocked();
    if (event === 'suspend' || event === 'resume') this.suspended = event === 'suspend';
    if (event === 'session_deactivated' || event === 'session_activated') this.inactiveSession = event === 'session_deactivated';
    if (event === 'lock' || event === 'unlock') this.locked = event === 'lock';
    this.reset();
    if (!wasBlocked && this.isBlocked()) this.options.onBlocked();
  }
}
