import { InitiativeSessionControls, type InitiativeSessionConditions } from '../application/services/initiative-session-controls';
import { WindowHelpRuntime } from '../application/services/window-help-runtime';
import { WindowHelpTargetTracker } from '../application/services/window-help-target-tracker';
import type { AIEventRuntime } from '../application/services/ai-event-runtime';
import type { ExternalWindowSurfacesPort } from '../application/ports/external-window-surfaces.port';
import type { ExplorePlan } from '../domain/behavior/explore-planner';
import { calculateRootCollisionRange, type CollisionInsets, type ScreenBoundsDto } from '../domain/behavior/motion-engine';
import type { ExternalWindowSurface } from '../domain/behavior/surface-kinematics';
import { selectWindowTopForRelease } from '../domain/behavior/external-surface-support';
import type { MainAutonomyComposition } from './main-autonomy-composition';
interface Options {
  readonly now: () => number; readonly streamId: () => string; readonly createId: () => string;
  readonly generation: () => number;
  readonly events: () => AIEventRuntime | undefined;
  readonly conditions: () => Omit<InitiativeSessionConditions, 'capability'>;
  readonly needs: () => { readonly boredom: number; readonly energy: number };
  readonly noCausal: () => boolean;
  readonly manualPresenceActive?: () => boolean;
  readonly screen: (surface: ExternalWindowSurface) => ScreenBoundsDto;
  readonly insets: () => CollisionInsets;
  readonly publish: () => void;
}
/** Process-owned consent survives Renderer remount, while each local goal remains volatile. */
export class MainInitiativeComposition {
  public readonly controls: InitiativeSessionControls;
  public help: WindowHelpRuntime | undefined;
  private tracker: WindowHelpTargetTracker | undefined;
  private capability = false;
  private releasePending = false;
  public constructor(private readonly options: Options) {
    this.controls = new InitiativeSessionControls({ streamId: options.streamId, now: options.now,
      conditions: () => ({ ...options.conditions(), capability: this.capability }),
      revoke: () => { this.help?.cancel(); options.events()?.invalidate(true, false); }, changed: options.publish });
  }
  public configure(capability: boolean): void { this.capability = capability; }
  public attach(composition: Pick<MainAutonomyComposition, 'getInitiativeBudget'>, port: ExternalWindowSurfacesPort | null): void {
    this.help?.cancel(); this.tracker?.dispose(); this.help = undefined; this.tracker = undefined;
    if (!port) return;
    this.tracker = new WindowHelpTargetTracker(port, { policyGeneration: () => this.controls.getPolicyGeneration(),
      screen: this.options.screen, insets: this.options.insets, feasible: surface => {
        if (surface.kind !== 'window_top') return false;
        try {
          const r = calculateRootCollisionRange(this.options.screen(surface), this.options.insets());
          const minX = Math.max(r.minX, surface.bounds.x), maxX = Math.min(r.maxX, surface.bounds.x + surface.bounds.width);
          if (minX > maxX) return false;
          return selectWindowTopForRelease([surface], { x: (minX + maxX) / 2, y: surface.supportY },
            () => ({ capturedAtMs: this.options.now(), screenBounds: this.options.screen(surface) }), this.options.insets())?.id === surface.id;
        } catch { return false; }
      } });
    this.help = new WindowHelpRuntime({ now: this.options.now, streamId: this.options.streamId, createId: this.options.createId,
      generation: this.options.generation, events: this.options.events, publish: this.options.publish,
      budget: composition.getInitiativeBudget(), target: id => this.tracker?.get(id, this.options.now()) ?? null,
      eligibility: () => {
        const c = this.options.conditions();
        return { ...this.options.needs(), noCausalOverride: this.options.noCausal(),
          allowed: this.controls.status().enabled && this.capability && c.memory && !c.quiet && !c.sleeping && !c.away && !c.busy
            && (this.options.manualPresenceActive?.() ?? false) };
      } });
  }
  public eligible(plan: ExplorePlan): boolean {
    return this.controls.allowed() && !!plan.targetSurface && !!this.tracker?.get(plan.surfaceId, this.options.now()) && this.options.noCausal()
      && !this.options.events()?.isBusy() && this.help?.eligible() === true;
  }
  public resolved(plan: ExplorePlan, decisionSequence: number, selectedAtMs: number): boolean {
    if (!this.eligible(plan)) return false;
    const target = this.tracker?.get(plan.surfaceId, this.options.now());
    return !!target && this.help?.begin({ decisionSequence, selectedAtMs, generation: this.options.generation(),
      reason: 'resolved_explore_needs_manual_support', target }) === true;
  }
  public admitDispatch(requestId: string): boolean {
    if (!this.controls.allowed()) return false;
    return this.help?.isRequest(requestId) ? this.help.admitDispatch(requestId) : true;
  }
  public acceptedDrag(): boolean { this.releasePending = false; return this.help?.acceptedDrag() === true; }
  public queuedRelease(): void { this.releasePending = this.help?.isAssisting() === true; }
  public motionEvent(type: string, attachedSurfaceId: string | null): void {
    if (type === 'airborne_started' || (type === 'drag_started' && !this.help?.isAssisting())) {
      this.invalidate(); return;
    }
    if (!this.releasePending || (type !== 'released' && type !== 'landed')) return;
    this.releasePending = false;
    this.help?.acceptedRelease(type === 'landed' ? attachedSurfaceId : null);
  }
  public invalidate(assist = false): void {
    if (!assist) { this.releasePending = false; this.help?.cancel(); }
    else this.help?.forcedOwner(true);
  }
  public resetProfile(): void { this.releasePending = false; this.controls.resetProfile(); }
  public dispose(): void { this.resetProfile(); this.tracker?.dispose(); this.help = undefined; }
}
