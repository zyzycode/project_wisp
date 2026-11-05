import type { ExternalWindowSurfacesPort, ExternalWindowSurfacesSnapshot } from '../ports/external-window-surfaces.port';
import type { VerifiedWindowHelpTarget, WindowHelpRegion } from '../ports/window-help.interface';
import type { CollisionInsets, ScreenBoundsDto } from '../../domain/behavior/motion-engine';
import type { ExternalWindowSurface } from '../../domain/behavior/surface-kinematics';
import { isExternalSurface, isFreshExternalObservation } from '../../domain/behavior/external-surface-support';

interface Options {
  readonly policyGeneration: () => number;
  readonly screen: (surface: ExternalWindowSurface) => ScreenBoundsDto;
  readonly insets: () => CollisionInsets;
  /** Existing Motion/manual-release feasibility, never a second planner draw. */
  readonly feasible: (surface: ExternalWindowSurface) => boolean;
}
const REGIONS: readonly WindowHelpRegion[] = ['upper_left', 'upper_center', 'upper_right',
  'middle_left', 'middle_center', 'middle_right', 'lower_left', 'lower_center', 'lower_right'];

/** Subscribes to the existing observer port only. Epoch describes application continuity, not OS ownership. */
export class WindowHelpTargetTracker {
  private snapshot: ExternalWindowSurfacesSnapshot;
  private sourceEpoch = 0;
  private readonly identities = new Map<string, { signature: string; epoch: number }>();
  private readonly unsubscribe: () => void;
  public constructor(port: ExternalWindowSurfacesPort, private readonly options: Options) {
    this.snapshot = port.getSnapshot();
    this.unsubscribe = port.subscribe(snapshot => this.observe(snapshot));
  }
  public dispose(): void { this.unsubscribe(); this.identities.clear(); }
  public get(surfaceId: string, nowMs: number): VerifiedWindowHelpTarget | null {
    const snapshot = this.snapshot;
    if (snapshot.capability !== 'available' || !isFreshExternalObservation(snapshot.capturedAtMs, nowMs)) return null;
    const candidates = snapshot.surfaces.filter(surface => surface.id === surfaceId);
    if (candidates.length !== 1) return null;
    const surface = candidates[0]!;
    if (!isExternalSurface(surface) || surface.kind !== 'window_top' || surface.id.length > 512
      || !this.options.feasible(surface)) return null;
    const screen = this.options.screen(surface), b = surface.bounds;
    if (![screen.x, screen.y, screen.width, screen.height].every(Number.isFinite)
      || screen.width <= 0 || screen.height <= 0) return null;
    const x = Math.max(screen.x, b.x), y = Math.max(screen.y, b.y);
    const right = Math.min(screen.x + screen.width, b.x + b.width);
    const bottom = Math.min(screen.y + screen.height, b.y + b.height);
    if (right <= x || bottom <= y) return null;
    // Coincident support rectangles cannot provide an unambiguous manual target.
    if (snapshot.surfaces.some(other => other.id !== surface.id && other.kind === 'window_top'
      && other.bounds.x === b.x && other.bounds.y === b.y && other.bounds.width === b.width
      && other.bounds.height === b.height && other.supportY === surface.supportY)) return null;
    const signature = this.signature(surface);
    if (signature.length > 512) return null;
    let identity = this.identities.get(surfaceId);
    if (!identity || identity.signature !== signature) {
      identity = { signature, epoch: ++this.sourceEpoch };
      this.identities.set(surfaceId, identity);
    }
    const left = (x - screen.x) / screen.width, top = (y - screen.y) / screen.height;
    const width = (right - x) / screen.width, height = (bottom - y) / screen.height;
    const column = Math.min(2, Math.floor((left + width / 2) * 3));
    const row = Math.min(2, Math.floor((top + height / 2) * 3));
    return { surfaceId, sourceEpoch: identity.epoch, policyGeneration: this.options.policyGeneration(),
      geometrySignature: signature, capturedAtMs: snapshot.capturedAtMs,
      preview: { region: REGIONS[row * 3 + column]!, left, top, width, height } };
  }
  private observe(snapshot: ExternalWindowSurfacesSnapshot): void {
    if (snapshot.revision <= this.snapshot.revision) return;
    if (snapshot.capability !== 'available' || this.snapshot.capability !== 'available') {
      this.sourceEpoch++;
      this.identities.clear();
    } else {
      for (const [id, identity] of this.identities) {
        const matching = snapshot.surfaces.filter(surface => surface.id === id);
        if (matching.length !== 1 || this.signature(matching[0]!) !== identity.signature) this.identities.delete(id);
      }
    }
    this.snapshot = snapshot;
  }
  private signature(surface: ExternalWindowSurface): string {
    const b = surface.bounds, screen = this.options.screen(surface), insets = this.options.insets();
    return JSON.stringify([surface.kind, b.x, b.y, b.width, b.height, surface.supportY,
      screen.x, screen.y, screen.width, screen.height, insets.left, insets.right, insets.top, insets.bottom]);
  }
}
