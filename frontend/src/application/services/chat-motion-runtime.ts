import type { ChatMotionCancellation, ChatMotionReceipt, ChatMotionRejection, ChatMotionRequest, ChatMotionTerminal, IChatMotion } from '../ports/chat-motion';
import type { ActivityDefinition, ActivityResult } from '../../domain/behavior/activity-runner';
import type { EnvironmentSnapshot } from '../../domain/behavior/surface-kinematics';
import { isFreshExternalObservation } from '../../domain/behavior/external-surface-support';

interface ChatMotionRuntimeOptions {
  readonly now: () => number;
  readonly gate: () => ChatMotionRejection | null;
  readonly environment: () => EnvironmentSnapshot;
  readonly plan: (direction: 'left' | 'right') => { kind: 'planned'; definition: ActivityDefinition; supportId: string } | { kind: 'rejected'; reason: 'no_support' | 'edge' };
  readonly start: (definition: ActivityDefinition) => string | null;
  readonly cancelRun: () => void;
  readonly terminal: (event: ChatMotionTerminal) => void;
}

/** Correlates one chat request with the existing Activity runner. No independent scheduler. */
export class ChatMotionRuntime implements IChatMotion {
  private active: { request: ChatMotionRequest; runId: string; support: string } | null = null;
  constructor(private readonly options: ChatMotionRuntimeOptions) {}

  public submit(request: ChatMotionRequest): ChatMotionReceipt {
    const hadActiveRun = this.active !== null;
    this.cancel(request.command.kind === 'stop' ? 'stop' : 'replaced');
    if (request.command.kind === 'stop') return { status: 'stopped', requestId: request.requestId, hadActiveRun };
    const reason = this.options.gate();
    if (reason) return { status: 'rejected', requestId: request.requestId, reason };
    const plan = this.options.plan(request.command.direction);
    if (plan.kind === 'rejected') return { status: 'rejected', requestId: request.requestId, reason: plan.reason };
    const support = this.supportIdentity();
    const runId = this.options.start(plan.definition);
    if (!runId) return { status: 'rejected', requestId: request.requestId, reason: 'unavailable' };
    this.active = { request, runId, support };
    return { status: 'started', requestId: request.requestId, runId };
  }

  public cancel(reason: ChatMotionCancellation): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    this.options.cancelRun();
    this.options.terminal({ status: 'cancelled', requestId: active.request.requestId, runId: active.runId, reason });
  }

  public settled(runId: string, result: ActivityResult): void {
    const active = this.active;
    if (!active || active.runId !== runId) return;
    this.active = null;
    this.options.terminal(result.status === 'completed'
      ? { status: 'completed', requestId: active.request.requestId, runId }
      : { status: 'cancelled', requestId: active.request.requestId, runId,
          reason: result.status === 'cancelled' && result.reason === 'step_timeout' ? 'timeout'
            : result.status === 'cancelled' && result.reason === 'critical_need' ? 'critical_need'
            : result.status === 'cancelled' && result.reason === 'forced_motion' ? 'forced_motion' : 'environment_changed' });
  }

  public tick(): void {
    if (!this.active) return;
    const reason = this.options.gate();
    if (reason) { this.cancel(reason === 'low_energy' || reason === 'overloaded' || reason === 'sleeping' ? 'critical_need' : 'forced_motion'); return; }
    const environment = this.options.environment();
    if (this.active.support !== this.supportIdentity() || (environment.currentSurface?.kind === 'window_top'
        && !isFreshExternalObservation(environment.capturedAtMs, this.options.now()))) this.cancel('environment_changed');
  }

  private supportIdentity(): string {
    const env = this.options.environment(), surface = env.currentSurface;
    return JSON.stringify([env.screenBounds, surface?.id, surface?.kind, surface?.bounds, surface?.isValidSupport]);
  }
}
