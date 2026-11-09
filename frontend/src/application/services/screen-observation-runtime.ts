import type { BackendScreenObservationCapability } from '../ports/backend-screen-observation-contract';
import type { IScreenObservationCapture, IScreenObservationProvider, PreparedScreenObservation, ScreenObservationContext, ScreenObservationRegion } from '../ports/screen-observation.interface';
import type { ScreenObservationError, ScreenObservationIdentity, ScreenObservationState } from '../../shared/screen-observation-contracts';
import { parseScreenEvidence, parseScreenRegion } from '../../shared/screen-observation-validation';

export interface ScreenObservationOptions {
  readonly capture: IScreenObservationCapture;
  readonly provider: IScreenObservationProvider;
  readonly now: () => number;
  readonly createId: () => string;
  readonly current: () => ScreenObservationIdentity | null;
  readonly busy: () => boolean;
  readonly schedule: (delayMs: number, callback: () => void) => () => void;
  readonly select: (identity: ScreenObservationIdentity) => Promise<void>;
  readonly closeSelector: () => void;
  readonly confirmCapture: () => Promise<boolean>;
  readonly confirmSend: () => Promise<boolean>;
  readonly hidden: <T>(work: () => Promise<T>) => Promise<T>;
}
const empty = (error: ScreenObservationError | null = null): ScreenObservationState => ({ phase: 'idle', error, preview: null, evidence: null });
/** RAM-only explicit workflow. Each continuation checks the original generation and deadline. */
export class ScreenObservationRuntime {
  private state: ScreenObservationState = empty();
  private context: ScreenObservationContext | null = null;
  private prepared: PreparedScreenObservation | null = null;
  private generation = 0;
  private abort: AbortController | null = null;
  private cancelTimer: (() => void) | null = null;
  private captureAfterMs = -Infinity;
  private disposed = false;
  constructor(private readonly options: ScreenObservationOptions) {}
  public read(): ScreenObservationState {
    if (this.context && !this.current(this.context)) this.cancel('stale');
    return this.state;
  }
  public isBusy(): boolean { return this.context !== null && this.state.phase !== 'visible'; }
  public cancel(error: ScreenObservationError | null = null): void {
    const requestId = this.context?.requestId;
    this.generation++; this.abort?.abort(); this.abort = null;
    this.cancelTimer?.(); this.cancelTimer = null;
    this.context = null; this.prepared = null; this.state = empty(error);
    this.options.closeSelector();
    if (requestId) this.options.provider.release(requestId);
  }
  public dispose(): void { if (this.disposed) return; this.disposed = true; this.cancel(); this.options.capture.dispose(); }
  public async start(identity: ScreenObservationIdentity): Promise<ScreenObservationState> {
    if (this.disposed) return empty('unavailable');
    if (this.isBusy() || this.options.busy()) return empty('busy');
    this.cancel();
    const availability = this.options.capture.availability();
    if (availability.status !== 'available') return this.state = empty(availability.reason === 'multiple_displays' ? 'multiple_displays' : availability.reason === 'unsupported_platform' ? 'unsupported_platform' : 'unavailable');
    if (this.options.now() < this.captureAfterMs) return this.state = empty('busy');
    const context: ScreenObservationContext = { streamId: identity.streamId, conversationId: identity.conversationId, requestId: this.options.createId(), generation: this.generation };
    if (!this.current(context) || !this.options.provider.reserve(context.requestId)) return this.state = empty('busy');
    this.context = context; this.abort = new AbortController();
    this.phase('selecting'); this.expire(30000);
    try {
      const capability: BackendScreenObservationCapability = await this.options.provider.getCapability(this.abort.signal);
      if (!this.current(context)) return this.read();
      if (capability.status !== 'available') { this.cancel('unavailable'); return this.read(); }
      await this.options.select(identity);
      if (!this.current(context)) this.cancel('stale');
    } catch { if (this.current(context)) this.cancel('unavailable'); }
    return this.read();
  }
  public async region(region: ScreenObservationRegion): Promise<ScreenObservationState> {
    const context = this.context;
    if (!context || this.state.phase !== 'selecting') return empty('stale');
    const selected = parseScreenRegion(region);
    this.phase('capture_confirmation');
    try {
      if (!await this.options.confirmCapture()) { if (this.current(context)) this.cancel('cancelled'); return this.read(); }
      if (!this.current(context)) return this.read();
      const authorizedAt = this.options.now();
      this.options.closeSelector();
      this.phase('preparing'); this.expire(5000);
      const signal = this.abort!.signal;
      this.captureAfterMs = authorizedAt + 30000;
      const prepared = await this.options.hidden(() => this.options.capture.capture({ context, region: selected, scope: 'one_full_single_screen_frame_for_crop', confirmationId: this.options.createId(), expiresAtMs: authorizedAt + 10000 }, signal));
      if (!this.current(context)) return this.read();
      if (prepared.context !== context || prepared.expiresAtMs <= this.options.now() || prepared.preparedAtMs + 30000 < prepared.expiresAtMs) throw new Error('Invalid capture');
      this.prepared = prepared;
      this.state = { phase: 'preview', error: null, evidence: null, preview: { previewId: prepared.previewId, dataBase64: prepared.image.dataBase64, width: prepared.image.width, height: prepared.image.height, expiresAtMs: prepared.expiresAtMs } };
      this.expire(Math.max(0, prepared.expiresAtMs - this.options.now()));
    } catch { if (this.current(context)) this.cancel('unavailable'); }
    return this.read();
  }
  public async send(): Promise<ScreenObservationState> {
    const context = this.context, prepared = this.prepared;
    if (this.state.phase === 'send_confirmation' || this.state.phase === 'generating') return this.read();
    if (!context || !prepared || this.state.phase !== 'preview' || prepared.expiresAtMs <= this.options.now()) { this.cancel('stale'); return this.read(); }
    this.state = { ...this.state, phase: 'send_confirmation' };
    try {
      if (!await this.options.confirmSend()) { if (this.current(context)) this.cancel('cancelled'); return this.read(); }
      if (!this.current(context)) return this.read();
      if (prepared !== this.prepared || this.options.now() >= prepared.expiresAtMs) { this.cancel('stale'); return this.read(); }
      const now = this.options.now();
      this.prepared = null; this.phase('generating'); this.expire(8000);
      const evidence = parseScreenEvidence(await this.options.provider.observe(prepared, { context, previewId: prepared.previewId, digest: prepared.digest, confirmationId: this.options.createId(), policyRevision: 'screen-openai-2026-11', authorizedAtMs: now, expiresAtMs: Math.min(now + 8000, prepared.expiresAtMs) }, 'ru', this.abort!.signal));
      if (!this.current(context)) return this.read();
      this.options.provider.release(context.requestId);
      this.state = { phase: 'visible', error: null, preview: null, evidence }; this.expire(60000);
    } catch { if (this.current(context)) this.cancel('unavailable'); }
    return this.read();
  }
  private current(context: ScreenObservationContext): boolean {
    const current = this.options.current();
    return !this.disposed && context.generation === this.generation && !!current && current.streamId === context.streamId && current.conversationId === context.conversationId;
  }
  private phase(phase: ScreenObservationState['phase']): void { this.state = { phase, error: null, preview: null, evidence: null }; }
  private expire(delayMs: number): void { this.cancelTimer?.(); this.cancelTimer = this.options.schedule(delayMs, () => this.cancel('timeout')); }
}
