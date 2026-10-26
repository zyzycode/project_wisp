import type { IPlatformAdapter } from '../application/ports/platform-adapter.interface';
import { DEFAULT_CURSOR_OBSERVE_CONSTRAINTS } from '../domain/behavior/cursor-observe-policy';
import { CursorProximityEngine, DEFAULT_CURSOR_REACTION_CONSTRAINTS,
  type CursorProximityState, type CursorSample } from '../domain/behavior/gaze-engine';
import type { Vector2Dto } from '../domain/behavior/motion-engine';

/** Sampling state only; reaction admission and Activity ownership remain in the composition. */
export class MainCursorObservationState {
  private readonly engine = new CursorProximityEngine();
  private proximity: CursorProximityState = { withinSwatRange: false, dwellWithinSwatRangeMs: 0, updatedAtMs: 0 };
  private observedAtMs: number | null = null;
  private nextPollAtMs = 0;
  private latestSample: CursorSample | null = null;
  private globalSample: CursorSample | null = null;
  private hasGlobalSource = false;
  public mustExit = false;

  public get latest(): CursorSample | null { return this.latestSample; }
  public get global(): CursorSample | null { return this.globalSample; }
  public get globalActive(): boolean { return this.hasGlobalSource; }

  public getGlobalSample(): CursorSample | null {
    return this.globalSample === null ? null : {
      ...this.globalSample, globalPosition: { ...this.globalSample.globalPosition },
    };
  }

  /** null means no poll; boolean reports the same publication change as the previous facade. */
  public poll(nowMs: number, source?: Pick<IPlatformAdapter, 'getCursorScreenPosition'>): boolean | null {
    if (!source || nowMs < this.nextPollAtMs) return null;
    this.nextPollAtMs = nowMs + 100;
    const position = source.getCursorScreenPosition();
    const hadSample = this.globalSample !== null;
    this.globalSample = position === null ? null : { globalPosition: { ...position }, capturedAtMs: nowMs };
    if (position === null) {
      if (this.hasGlobalSource) {
        this.latestSample = null;
        this.observedAtMs = null;
        this.mustExit = false;
        this.proximity = { withinSwatRange: false, dwellWithinSwatRangeMs: 0, updatedAtMs: nowMs };
      }
      this.hasGlobalSource = false;
      return hadSample;
    }
    this.hasGlobalSource = true;
    return true;
  }

  public observe(position: Vector2Dto, nowMs: number, root: Vector2Dto, compatible: boolean) {
    this.latestSample = { globalPosition: position, capturedAtMs: nowMs };
    if (Math.hypot(position.x - root.x, position.y - root.y) > DEFAULT_CURSOR_OBSERVE_CONSTRAINTS.ambientRadiusWorldPx) this.mustExit = false;
    const update = this.engine.update(this.proximity, {
      nowMs, rootGlobalPosition: root, cursor: { globalPosition: position, capturedAtMs: nowMs }, compatible,
    });
    this.proximity = update.state;
    this.observedAtMs = nowMs;
    return update;
  }

  public getDwell(nowMs: number, root: Vector2Dto): number {
    this.proximity = this.engine.update(this.proximity, {
      nowMs, rootGlobalPosition: root, ...(this.latestSample ? { cursor: this.latestSample } : {}), compatible: true,
    }).state;
    return this.proximity.dwellWithinSwatRangeMs;
  }

  public expire(nowMs: number, root: Vector2Dto): boolean {
    if (this.observedAtMs === null || nowMs - this.observedAtMs <= DEFAULT_CURSOR_REACTION_CONSTRAINTS.signalMaxAgeMs) return false;
    this.proximity = this.engine.update(this.proximity, { nowMs, rootGlobalPosition: root, compatible: false }).state;
    this.observedAtMs = null;
    this.mustExit = false;
    return true;
  }

  public resetInterest(nowMs: number): void {
    this.hasGlobalSource = false;
    this.observedAtMs = null;
    this.latestSample = null;
    this.proximity = { withinSwatRange: false, dwellWithinSwatRangeMs: 0, updatedAtMs: nowMs };
  }

  public resetPolling(): void { this.globalSample = null; this.nextPollAtMs = 0; }
}
