import type { IInitiativeControls, InitiativeBlockReason, InitiativeConsentCommandDTO,
  InitiativeControlCommandDTO, InitiativeControlResultDTO, InitiativeControlStatusDTO,
} from '../ports/initiative-controls.interface';

export interface InitiativeSessionConditions {
  readonly capability: boolean;
  readonly memory: boolean;
  readonly quiet: boolean;
  readonly sleeping: boolean;
  readonly away: boolean;
  readonly busy: boolean;
}
interface Options {
  readonly now?: () => number;
  readonly streamId: () => string;
  readonly conditions: () => InitiativeSessionConditions;
  /** Cancels transport, speech, source, timers, help and previous initiative synchronously. */
  readonly revoke: () => void;
  readonly changed?: () => void;
}
type Failure = InitiativeControlStatusDTO['lastFailure'];
type Phase = InitiativeControlStatusDTO['phase'];

/** RAM-only process session. Credentials and factory capability never imply consent. */
export class InitiativeSessionControls implements IInitiativeControls {
  private enabled = false;
  private enabledAtMs = Infinity;
  private profileGeneration = 0;
  private policyGeneration = 0;
  private requestsSent = 0;
  private lastFailure: Failure = 'none';
  private phase: Phase = 'waiting';
  public constructor(private readonly options: Options) {}

  public status(): InitiativeControlStatusDTO {
    const conditions = this.options.conditions();
    const blockReason: InitiativeBlockReason = !this.enabled ? 'disabled'
      : conditions.quiet ? 'quiet' : conditions.sleeping ? 'sleeping'
        : conditions.away ? 'away' : !conditions.capability ? 'provider_unavailable'
          : !conditions.memory ? 'memory_unavailable' : conditions.busy ? 'busy' : 'none';
    return { profileGeneration: this.profileGeneration, enabled: this.enabled,
      capability: conditions.capability && conditions.memory ? 'ready' : 'unavailable',
      phase: !this.enabled ? 'off' : blockReason === 'none' ? this.phase : 'waiting',
      blockReason, requestsSent: this.requestsSent, lastFailure: this.lastFailure };
  }
  public allowed(): boolean { return this.status().blockReason === 'none'; }
  public getPolicyGeneration(): number { return this.policyGeneration; }
  public sourceAllowed(atMs: number): boolean {
    return this.enabled && Number.isFinite(atMs) && atMs >= this.enabledAtMs;
  }

  public async read(command: InitiativeControlCommandDTO): Promise<InitiativeControlResultDTO> {
    if (!this.validRead(command) || Object.keys(command).some(key => key !== 'streamId')) return { ok: false, code: 'invalid_input' };
    return command.streamId === this.options.streamId()
      ? { ok: true, status: this.status() } : { ok: false, code: 'stale' };
  }
  public async setConsent(command: InitiativeConsentCommandDTO): Promise<InitiativeControlResultDTO> {
    if (!this.validRead(command) || typeof command.enabled !== 'boolean'
      || !Number.isSafeInteger(command.profileGeneration) || command.profileGeneration < 0
      || Object.keys(command).some(key => !['streamId', 'profileGeneration', 'enabled'].includes(key))) {
      return { ok: false, code: 'invalid_input' };
    }
    if (command.streamId !== this.options.streamId() || command.profileGeneration !== this.profileGeneration) {
      return { ok: false, code: 'stale' };
    }
    const conditions = this.options.conditions();
    if (command.enabled && (!conditions.capability || !conditions.memory)) return { ok: false, code: 'unavailable' };
    if (this.enabled !== command.enabled) {
      this.policyGeneration++;
      this.enabled = command.enabled;
      this.enabledAtMs = this.enabled ? this.options.now?.() ?? -Infinity : Infinity;
      if (!this.enabled) this.options.revoke();
      this.phase = 'waiting';
      this.options.changed?.();
    }
    return { ok: true, status: this.status() };
  }
  /** Call before awaiting reset/profile storage acknowledgement, even if stream stays unchanged. */
  public resetProfile(): void {
    this.profileGeneration++;
    this.policyGeneration++;
    this.enabled = false;
    this.enabledAtMs = Infinity;
    this.phase = 'waiting';
    this.options.revoke();
    this.options.changed?.();
  }
  /** Called only at the actual autonomous event HTTP dispatch boundary. */
  public dispatched(): void { this.requestsSent++; this.lastFailure = 'none'; }
  public failed(failure: Failure): void { this.lastFailure = failure; this.options.changed?.(); }
  public setPhase(phase: Exclude<Phase, 'off'>): void { this.phase = phase; this.options.changed?.(); }
  private validRead(command: InitiativeControlCommandDTO): boolean {
    return typeof command === 'object' && command !== null && typeof command.streamId === 'string'
      && command.streamId.length > 0 && command.streamId.length <= 512;
  }
}
