import type { ExternalWindowFocusPort, PreparedWindowFocus, WindowFocusAuthorization,
  WindowFocusOutcome, WindowFocusPreparation } from '../../application/ports/external-window-focus.port';
import type { FocusBridgeCommand, FocusBridgeTarget } from './window-focus-protocol';
import { focusId } from '../../shared/window-focus-validation';
type BridgeResult = { readonly status: 'prepared'; readonly preparedId: string } | WindowFocusOutcome;
interface Options {
  readonly now: () => number; readonly createId: () => string;
  readonly generation: () => number;
  readonly lookup: (surfaceId: string) => FocusBridgeTarget | undefined;
  readonly exchange: (command: FocusBridgeCommand, signal: AbortSignal) => Promise<BridgeResult>;
}
interface Prepared {
  readonly attemptId: string; readonly nativeAttempt: string; readonly nonce: string;
  readonly target: FocusBridgeTarget; readonly generation: number; readonly authorizationKey: string;
  readonly signal: AbortSignal; readonly until: number;
}
/** Separate action capability over the same private observer helper. No HWND leaves the helper. */
export class WindowsWindowFocus implements ExternalWindowFocusPort {
  private prepared: Prepared | null = null;
  private terminal: { id: string; value: WindowFocusOutcome; until: number } | null = null;
  private pending: { id: string; promise: Promise<WindowFocusOutcome> } | null = null;
  private disposed = false;
  private preparing = false;
  public constructor(private readonly options: Options) {}
  public async prepare(authorization: WindowFocusAuthorization, signal: AbortSignal): Promise<WindowFocusPreparation> {
    if (!this.valid(authorization) || this.disposed || signal.aborted) return { status: 'rejected', reason: 'cancelled_before_dispatch' };
    if (this.prepared && (this.prepared.signal.aborted || this.options.now() >= this.prepared.until)) this.prepared = null;
    if (this.preparing || this.pending || this.prepared || this.terminal?.id === authorization.attemptId) return { status: 'rejected', reason: 'duplicate' };
    const target = this.options.lookup(authorization.target.surfaceId);
    if (!target) return { status: 'rejected', reason: 'target_lost' };
    if (target.signature !== authorization.target.geometrySignature) return { status: 'rejected', reason: 'target_changed' };
    this.preparing = true;
    const generation = this.options.generation(), nativeAttempt = this.options.createId();
    try {
      const result = await this.options.exchange({ action: 'prepare', attempt: nativeAttempt, target }, signal);
      if (signal.aborted || this.disposed) return { status: 'rejected', reason: 'cancelled_before_dispatch' };
      if (generation !== this.options.generation()) return { status: 'rejected', reason: 'target_lost' };
      if (result.status !== 'prepared') return result.status === 'rejected' || result.status === 'unsupported' ? result : { status: 'rejected', reason: 'unavailable' };
      this.prepared = { attemptId: authorization.attemptId, nativeAttempt, nonce: result.preparedId,
        target, generation, authorizationKey: JSON.stringify(authorization), signal, until: Math.min(authorization.expiresAtMs, this.options.now() + 500) };
      return { status: 'prepared', value: { attemptId: authorization.attemptId, preparedId: result.preparedId } };
    } catch { return { status: 'rejected', reason: 'unavailable' }; }
    finally { this.preparing = false; }
  }
  public commit(authorization: WindowFocusAuthorization, prepared: PreparedWindowFocus, signal: AbortSignal): Promise<WindowFocusOutcome> {
    if (this.pending?.id === authorization.attemptId) return this.pending.promise;
    if (this.terminal?.id === authorization.attemptId && this.options.now() < this.terminal.until) return Promise.resolve(this.terminal.value);
    const source = this.prepared;
    if (!source || source.attemptId !== authorization.attemptId || prepared.attemptId !== source.attemptId) return Promise.resolve({ status: 'rejected', reason: 'duplicate' });
    this.prepared = null;
    if (prepared.preparedId !== source.nonce) return Promise.resolve({ status: 'rejected', reason: 'duplicate' });
    if (!this.valid(authorization) || source.authorizationKey !== JSON.stringify(authorization) || source.signal.aborted || this.options.now() >= source.until || signal.aborted || this.disposed) return Promise.resolve({ status: 'rejected', reason: 'cancelled_before_dispatch' });
    const current = this.options.lookup(authorization.target.surfaceId);
    if (!current || source.generation !== this.options.generation() || current.signature !== source.target.signature || current.token !== source.target.token) return Promise.resolve({ status: 'rejected', reason: 'target_changed' });
    const execution = this.executeCommit(source, signal);
    this.pending = { id: source.attemptId, promise: execution };
    void execution.finally(() => { if (this.pending?.promise === execution) this.pending = null; });
    return execution;
  }
  public dispose(): void { this.disposed = true; this.prepared = null; this.terminal = null; }
  private async executeCommit(source: Prepared, signal: AbortSignal): Promise<WindowFocusOutcome> {
    let outcome: WindowFocusOutcome;
    try {
      const result = await this.options.exchange({ action: 'commit', attempt: source.nativeAttempt, nonce: source.nonce, token: source.target.token }, signal);
      if (signal.aborted || this.disposed) outcome = { status: 'unknown', reason: 'cancelled_after_dispatch' };
      else if (source.generation !== this.options.generation()) outcome = { status: 'unknown', reason: 'target_changed_after_dispatch' };
      else outcome = result.status === 'prepared' ? { status: 'unknown', reason: 'verification_unavailable' } : result;
    } catch { outcome = { status: 'unknown', reason: 'bridge_lost' }; }
    if (!this.disposed) this.terminal = { id: source.attemptId, value: outcome, until: this.options.now() + 60000 };
    return outcome;
  }
  private valid(a: WindowFocusAuthorization): boolean {
    try {
      focusId(a.attemptId); focusId(a.confirmationId); focusId(a.context.streamId); focusId(a.context.conversationId); focusId(a.context.requestId);
      if (!Number.isSafeInteger(a.context.generation) || a.context.generation < 0 || !Number.isSafeInteger(a.target.sourceEpoch)
        || a.target.sourceEpoch < 0 || a.target.sourceEpoch !== this.options.generation() || !Number.isSafeInteger(a.target.policyGeneration) || a.target.policyGeneration < 0
        || typeof a.target.surfaceId !== 'string' || a.target.surfaceId.length > 512 || !a.target.surfaceId
        || typeof a.target.geometrySignature !== 'string' || !a.target.geometrySignature || a.target.geometrySignature.length > 512) return false;
      const now = this.options.now(), age = now - a.target.capturedAtMs;
      return Number.isFinite(age) && age >= 0 && age <= 300 && Number.isFinite(a.authorizedAtMs)
        && now >= a.authorizedAtMs && now < a.expiresAtMs && a.expiresAtMs - a.authorizedAtMs <= 5000;
    } catch { return false; }
  }
}
export const unsupportedWindowFocus = (): ExternalWindowFocusPort => ({
  prepare: async () => ({ status: 'unsupported' }), commit: async () => ({ status: 'unsupported' }), dispose: () => undefined,
});
