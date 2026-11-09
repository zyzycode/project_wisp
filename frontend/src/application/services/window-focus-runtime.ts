import type { ExternalWindowFocusPort, WindowFocusAuthorization, WindowFocusChooseCommandDTO,
  WindowFocusOpenCommandDTO, WindowFocusOutcome, WindowFocusPreviewDTO, WindowFocusReceiptDTO,
  WindowFocusRequestContext, WindowFocusTarget, WindowFocusCandidate } from '../ports/external-window-focus.port';
import type { IWindowFocusControls, WindowFocusControlResult, WindowFocusStateDTO } from '../ports/window-focus-controls.interface';
import type { MemoryScheduler } from '../ports/memory-runtime';
import { parseWindowFocusChoose, parseWindowFocusOpen, parseWindowFocusOutcome, parseWindowFocusSelector } from '../../shared/window-focus-validation';
export type { WindowFocusCandidate } from '../ports/external-window-focus.port';
interface Options {
  readonly now: () => number; readonly createId: () => string; readonly scheduler: MemoryScheduler;
  readonly capability: () => WindowFocusStateDTO['capability'];
  readonly context: () => Omit<WindowFocusRequestContext, 'requestId'> | null;
  readonly active: () => boolean;
  readonly candidates: (policyGeneration: number) => readonly WindowFocusCandidate[];
  /** Main-owned native UI. Renderer never supplies this decision. */
  readonly confirm: (preview: WindowFocusPreviewDTO, signal: AbortSignal) => Promise<boolean>;
  readonly port: ExternalWindowFocusPort;
  readonly publish?: () => void;
}
interface Selection { readonly id: string; readonly candidate: WindowFocusCandidate }
interface Pending { readonly target: WindowFocusTarget; readonly id: string; readonly controller: AbortController; readonly epoch: number; dispatched: boolean }
/** One explicit RAM request and one bounded receipt; never a model tool or durable memory. */
export class WindowFocusRuntime implements IWindowFocusControls {
  private epoch = 0;
  private request: WindowFocusRequestContext | null = null;
  private selector: { id: string; expires: number; selections: readonly Selection[] } | null = null;
  private receipt: WindowFocusReceiptDTO | null = null;
  private receiptUntil = 0;
  private attempt: Pending | null = null;
  private pending: Promise<WindowFocusControlResult> | null = null;
  private chosenId: string | null = null;
  private chosenSelectorId: string | null = null;
  private disposed = false;
  public constructor(private readonly options: Options) {}
  public state(): WindowFocusStateDTO {
    this.revalidate();
    if (this.options.now() >= this.receiptUntil) this.receipt = null;
    const selector = this.selector && this.options.now() < this.selector.expires ? parseWindowFocusSelector({
      selectorId: this.selector.id, expiresAtMs: this.selector.expires,
      candidates: this.selector.selections.map(s => ({ ...s.candidate.preview, selectionId: s.id })),
    }) : null;
    return { capability: this.options.capability(), selector, pending: this.attempt !== null, receipt: this.receipt };
  }
  public async read(raw: WindowFocusOpenCommandDTO): Promise<WindowFocusControlResult> {
    let command; try { command = parseWindowFocusOpen(raw); } catch { return { ok: false, code: 'invalid_input' }; }
    if (!this.request || !this.matches(command, this.request) || !this.current(this.request)) return { ok: false, code: 'stale' };
    return this.result();
  }
  /** Live observer/context discontinuities invalidate RAM authority before the next await. */
  public revalidate(): void {
    if (this.request && (!this.current(this.request) || !this.options.active())) { this.invalidate(); return; }
    const attempt = this.attempt;
    if (attempt && this.request) {
      const outcome = this.check(this.request, attempt.target, attempt);
      if (outcome) { this.complete(attempt, outcome); attempt.controller.abort(); }
    }
  }
  public async open(raw: WindowFocusOpenCommandDTO): Promise<WindowFocusControlResult> {
    let command; try { command = parseWindowFocusOpen(raw); } catch { return { ok: false, code: 'invalid_input' }; }
    const context = this.options.context();
    if (!context || this.disposed || command.streamId !== context.streamId || command.conversationId !== context.conversationId) return { ok: false, code: 'stale' };
    if (this.request?.requestId === command.requestId && this.current(this.request)) return this.result();
    if (this.pending) return { ok: false, code: 'busy' };
    this.epoch++; this.receipt = null; this.chosenId = null; this.chosenSelectorId = null;
    this.request = { ...context, requestId: command.requestId };
    const candidates = this.options.capability() === 'available' && this.options.active()
      ? this.options.candidates(this.epoch).filter(c => this.fresh(c.target)).slice(0, 20) : [];
    this.selector = { id: this.options.createId(), expires: this.options.now() + 30000,
      selections: candidates.map(candidate => ({ id: this.options.createId(), candidate })) };
    return this.result();
  }
  public choose(raw: WindowFocusChooseCommandDTO): Promise<WindowFocusControlResult> {
    let command; try { command = parseWindowFocusChoose(raw); } catch { return Promise.resolve({ ok: false, code: 'invalid_input' }); }
    const context = this.request, selector = this.selector;
    if (!context || !this.matches(command, context) || !this.current(context)) return Promise.resolve({ ok: false, code: 'stale' });
    if (this.chosenId !== null) return this.chosenId === command.selectionId && this.chosenSelectorId === command.selectorId
      ? this.pending ?? Promise.resolve(this.receipt && this.options.now() < this.receiptUntil ? this.result() : { ok: false, code: 'stale' }) : Promise.resolve({ ok: false, code: 'busy' });
    if (!selector || command.selectorId !== selector.id) return Promise.resolve({ ok: false, code: 'stale' });
    const selection = selector.selections.find(s => s.id === command.selectionId);
    if (!selection) return Promise.resolve({ ok: false, code: 'invalid_input' });
    this.chosenId = selection.id; this.chosenSelectorId = selector.id;
    const attempt: Pending = { target: selection.candidate.target, id: this.options.createId(), controller: new AbortController(), epoch: this.epoch, dispatched: false };
    this.attempt = attempt;
    const execution = this.execute(context, selection, selector.expires, attempt);
    this.pending = execution;
    void execution.finally(() => { if (this.pending === execution) this.pending = null; });
    return execution;
  }
  public async cancel(raw: WindowFocusOpenCommandDTO): Promise<WindowFocusControlResult> {
    let command; try { command = parseWindowFocusOpen(raw); } catch { return { ok: false, code: 'invalid_input' }; }
    if (!this.request || !this.matches(command, this.request) || !this.current(this.request)) return { ok: false, code: 'stale' };
    const attempt = this.attempt;
    this.selector = null;
    if (attempt) {
      this.complete(attempt, attempt.dispatched ? { status: 'unknown', reason: 'cancelled_after_dispatch' }
        : { status: 'rejected', reason: 'cancelled_before_dispatch' });
      attempt.controller.abort();
    }
    return this.result();
  }
  /** Called synchronously for reset/revoke/lock/suspend/quiet/dispose; no grant survives resume. */
  public invalidate(): void {
    this.epoch++; const attempt = this.attempt;
    this.selector = null; this.receipt = null; this.request = null; this.attempt = null;
    attempt?.controller.abort(); this.options.publish?.();
  }
  public dispose(): void { if (this.disposed) return; this.disposed = true; this.invalidate(); this.options.port.dispose(); }
  private async execute(context: WindowFocusRequestContext, selection: Selection, selectorExpires: number, attempt: Pending): Promise<WindowFocusControlResult> {
    let timer: unknown;
    let deadlineExpired = false;
    try {
      const unavailable = this.check(context, selection.candidate.target, attempt);
      if (unavailable) return this.finish(attempt, unavailable);
      if (this.options.now() >= selectorExpires) return this.finish(attempt, { status: 'rejected', reason: 'expired' });
      const consent = await this.confirm(selection, selectorExpires, attempt);
      if (consent === null || this.options.now() >= selectorExpires) return this.finish(attempt, { status: 'rejected', reason: 'expired' });
      if (!consent) return this.finish(attempt, { status: 'rejected', reason: 'declined' });
      const afterConsent = this.check(context, selection.candidate.target, attempt);
      if (afterConsent) return this.finish(attempt, afterConsent);
      const now = this.options.now();
      const refreshed = this.options.candidates(this.epoch).find(c => c.target.surfaceId === selection.candidate.target.surfaceId);
      if (!refreshed || !this.fresh(refreshed.target)) return this.finish(attempt, { status: 'rejected', reason: 'target_lost' });
      const authorization: WindowFocusAuthorization = { attemptId: attempt.id, context, target: refreshed.target,
        confirmationId: this.options.createId(), authorizedAtMs: now, expiresAtMs: now + 5000 };
      const timeout = new Promise<WindowFocusOutcome>(resolve => { timer = this.options.scheduler.setTimeout(() => {
        deadlineExpired = true; resolve(attempt.dispatched ? { status: 'unknown', reason: 'timeout_after_dispatch' }
          : { status: 'rejected', reason: 'expired' }); attempt.controller.abort();
      }, 5000); });
      const work = async (): Promise<WindowFocusOutcome> => {
        const prepared = await this.options.port.prepare(authorization, attempt.controller.signal);
        const afterPrepare = this.check(context, selection.candidate.target, attempt);
        if (afterPrepare) return afterPrepare;
        if (this.options.now() >= authorization.expiresAtMs) return { status: 'rejected', reason: 'expired' };
        if (prepared.status !== 'prepared') return prepared;
        if (prepared.value.attemptId !== attempt.id) return { status: 'rejected', reason: 'invalid_request' };
        // The only irreversible boundary. No await or new authority between this check and commit.
        attempt.dispatched = true;
        return this.options.port.commit(authorization, prepared.value, attempt.controller.signal);
      };
      const outcome = parseWindowFocusOutcome(await Promise.race([work(), timeout]));
      const finalCheck = this.check(context, selection.candidate.target, attempt);
      return this.finish(attempt, deadlineExpired && attempt.epoch === this.epoch && this.current(context) && this.options.active() ? outcome : finalCheck ?? outcome);
    } catch { return this.finish(attempt, attempt.dispatched ? { status: 'unknown', reason: 'bridge_lost' }
      : { status: 'rejected', reason: 'unavailable' }); }
    finally { if (timer !== undefined) this.options.scheduler.clearTimeout(timer); if (!attempt.dispatched) attempt.controller.abort(); }
  }
  private async confirm(selection: Selection, expires: number, attempt: Pending): Promise<boolean | null> {
    let timer: unknown;
    let stop!: () => void;
    const stopped = new Promise<null>(resolve => {
      stop = () => resolve(null);
      timer = this.options.scheduler.setTimeout(() => { stop(); attempt.controller.abort(); }, Math.max(0, expires - this.options.now()));
      attempt.controller.signal.addEventListener('abort', stop, { once: true });
    });
    try { return await Promise.race([this.options.confirm({ ...selection.candidate.preview, selectionId: selection.id }, attempt.controller.signal), stopped]); }
    finally { this.options.scheduler.clearTimeout(timer); attempt.controller.signal.removeEventListener('abort', stop); }
  }
  private check(context: WindowFocusRequestContext, target: WindowFocusTarget, attempt: Pending): WindowFocusOutcome | null {
    const invalidated = attempt.epoch !== this.epoch || attempt.controller.signal.aborted || !this.current(context) || !this.options.active();
    if (invalidated) return attempt.dispatched ? { status: 'unknown', reason: 'cancelled_after_dispatch' }
      : { status: 'rejected', reason: 'cancelled_before_dispatch' };
    if (this.options.capability() !== 'available') return attempt.dispatched ? { status: 'unknown', reason: 'verification_unavailable' }
      : this.options.capability() === 'unsupported' ? { status: 'unsupported' } : { status: 'rejected', reason: 'unavailable' };
    const candidate = this.options.candidates(this.epoch).find(c => c.target.surfaceId === target.surfaceId);
    if (!candidate || !this.fresh(candidate.target)) return attempt.dispatched ? { status: 'unknown', reason: 'target_changed_after_dispatch' }
      : { status: 'rejected', reason: 'target_lost' };
    if (candidate.target.sourceEpoch !== target.sourceEpoch || candidate.target.policyGeneration !== target.policyGeneration
      || candidate.target.geometrySignature !== target.geometrySignature) return attempt.dispatched ? { status: 'unknown', reason: 'target_changed_after_dispatch' }
      : { status: 'rejected', reason: 'target_changed' };
    return null;
  }
  private finish(attempt: Pending, outcome: WindowFocusOutcome): WindowFocusControlResult {
    if (this.attempt === attempt && attempt.epoch === this.epoch) { this.complete(attempt, outcome); return this.result(); }
    return { ok: true, state: { capability: this.options.capability(), selector: null, pending: false,
      receipt: { attemptId: attempt.id, ...(attempt.dispatched ? { status: 'unknown', reason: 'cancelled_after_dispatch' } as const : { status: 'rejected', reason: 'cancelled_before_dispatch' } as const) } } };
  }
  private complete(attempt: Pending, outcome: WindowFocusOutcome): void {
    this.receipt = { ...outcome, attemptId: attempt.id }; this.receiptUntil = this.options.now() + 60000;
    this.attempt = null; this.selector = null; this.options.publish?.();
  }
  private current(context: WindowFocusRequestContext): boolean {
    const now = this.options.context();
    return !this.disposed && !!now && now.streamId === context.streamId && now.conversationId === context.conversationId && now.generation === context.generation;
  }
  private matches(command: WindowFocusOpenCommandDTO, context: WindowFocusRequestContext): boolean {
    return command.streamId === context.streamId && command.conversationId === context.conversationId && command.requestId === context.requestId;
  }
  private fresh(target: WindowFocusTarget): boolean { const age = this.options.now() - target.capturedAtMs; return Number.isFinite(age) && age >= 0 && age <= 300; }
  private result(): WindowFocusControlResult { return { ok: true, state: this.state() }; }
}
