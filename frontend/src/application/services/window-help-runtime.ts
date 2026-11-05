import type { IWindowHelpControls, VerifiedWindowHelpTarget, WindowHelpChoice,
  WindowHelpDeclineCommandDTO, WindowHelpStatusDTO } from '../ports/window-help.interface';
import { WindowHelpSession, type WindowHelpEligibility } from './window-help-session';
import type { InitiativeBudget } from './initiative-budget';
import type { AIEventRuntime } from './ai-event-runtime';

interface Options {
  readonly now: () => number;
  readonly streamId: () => string;
  readonly createId: () => string;
  readonly eligibility: () => WindowHelpEligibility;
  readonly generation: () => number;
  readonly target: (surfaceId: string) => VerifiedWindowHelpTarget | null;
  readonly budget: InitiativeBudget;
  readonly events: () => AIEventRuntime | undefined;
  readonly publish: () => void;
}
/** Coordinates existing Motion provenance and event text. Never starts an Activity or provider action. */
export class WindowHelpRuntime implements IWindowHelpControls {
  private readonly session: WindowHelpSession;
  private activeRequestId: string | null = null;
  private generation = -1;
  public constructor(private readonly options: Options) {
    this.session = new WindowHelpSession({
      cancelGeneration: () => { if (this.activeRequestId) this.options.events()?.cancelWindowHelp(this.activeRequestId); },
      clearSpeech: () => { if (this.activeRequestId) this.options.events()?.cancelWindowHelp(this.activeRequestId); },
      closed: (_id, outcome) => {
        this.options.events()?.updateWindowHelpOutcome(outcome);
        this.options.publish();
      },
    });
  }
  public eligible(): boolean {
    return this.options.budget.available(this.options.now())
      && this.session.eligible(this.options.now(), this.options.eligibility());
  }
  public isRequest(requestId: string): boolean { return this.session.requestId() === requestId; }
  public isAssisting(): boolean { return this.session.isAssisting(); }
  public begin(choice: WindowHelpChoice): boolean {
    if (!this.eligible() || choice.generation !== this.options.generation()) return false;
    const target = this.options.target(choice.target.surfaceId);
    if (!target || !this.sameTarget(target, choice.target)) return false;
    const requestId = this.options.createId();
    if (!this.session.prepare({ ...choice, target }, requestId, this.options.now(), this.options.eligibility())) return false;
    this.activeRequestId = requestId; this.generation = choice.generation;
    if (!this.options.events()?.windowHelpStarted(requestId, target.preview.region)) {
      this.session.cancel(this.options.now()); return false;
    }
    this.options.publish(); return true;
  }
  public current(requestId: string): boolean {
    this.tick();
    return this.session.requestId() === requestId && this.generation === this.options.generation();
  }
  /** Called by ExternalAIProviderClient immediately before fetch; not on adapter invocation. */
  public admitDispatch(requestId: string): boolean {
    if (!this.current(requestId) || !this.options.budget.available(this.options.now())) return false;
    if (!this.session.dispatched(requestId, this.options.now())) return false;
    return this.options.budget.start(this.options.now());
  }
  public published(requestId: string): boolean {
    if (!this.current(requestId) || !this.session.published(requestId, this.options.now())) return false;
    this.options.publish(); return true;
  }
  public failed(requestId: string): void { this.session.generationFailed(requestId, this.options.now()); }
  public acceptedDrag(): boolean {
    this.tick();
    const accepted = this.session.beginAcceptedDrag(this.options.now());
    if (accepted) {
      this.options.events()?.assistContact();
      this.options.events()?.updateWindowHelpOutcome('assisting');
      this.options.publish();
    }
    return accepted;
  }
  public acceptedRelease(surfaceId: string | null): void {
    this.tick();
    this.session.acceptedRelease(surfaceId === null ? null : this.options.target(surfaceId), this.options.now());
  }
  public cancel(): void { this.session.cancel(this.options.now()); }
  public forcedOwner(acceptedAssistDrag = false): void {
    this.session.forcedOwner(this.options.now(), acceptedAssistDrag);
  }
  public tick(): void {
    const now = this.options.now(), eligibility = this.options.eligibility();
    this.session.observeBoredom(eligibility.boredom, now);
    this.session.tick(now);
    const target = this.session.target();
    if (!target) return;
    if (!eligibility.allowed || !eligibility.noCausalOverride || this.generation !== this.options.generation()
      || ![eligibility.boredom, eligibility.energy].every(value => Number.isFinite(value) && value >= 0 && value <= 100)
      || eligibility.energy < 30) {
      this.session.cancel(now); return;
    }
    this.session.refresh(this.options.target(target.surfaceId), now);
  }
  public status(): WindowHelpStatusDTO { this.tick(); return this.session.status(this.options.now()); }
  public async decline(command: WindowHelpDeclineCommandDTO) {
    if (typeof command !== 'object' || command === null || typeof command.streamId !== 'string'
      || typeof command.requestId !== 'string' || !command.requestId || command.requestId.length > 512
      || Object.keys(command).some(key => key !== 'streamId' && key !== 'requestId')) {
      return { ok: false as const, code: 'invalid_input' as const };
    }
    if (command.streamId !== this.options.streamId() || !this.session.decline(command.requestId, this.options.now())) {
      return { ok: false as const, code: 'stale' as const };
    }
    return { ok: true as const };
  }
  private sameTarget(a: VerifiedWindowHelpTarget, b: VerifiedWindowHelpTarget): boolean {
    return a.surfaceId === b.surfaceId && a.sourceEpoch === b.sourceEpoch
      && a.policyGeneration === b.policyGeneration && a.geometrySignature === b.geometrySignature;
  }
}
