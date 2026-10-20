import { isExternalSurface, isRootInsideEnvironment } from './external-surface-support';
import { calculateRootCollisionRange, type CollisionInsets, type Vector2Dto, type ScreenBoundsDto } from './motion-engine';
import type { EnvironmentSnapshot, ExternalWindowSurface } from './surface-kinematics';

type WindowTop = Extract<ExternalWindowSurface, { kind: 'window_top' }>;

/** Only windows observed at the start of this airborne episode can catch its subsequent fall. */
export class ReleasedWindowLanding {
  private candidates: readonly WindowTop[] = [];
  private boundsId: string | undefined;
  private bounds: ScreenBoundsDto | undefined;

  public begin(surfaces: readonly ExternalWindowSurface[], boundsId: string, bounds?: ScreenBoundsDto): void {
    this.candidates = surfaces.filter((s): s is WindowTop => isExternalSurface(s) && s.kind === 'window_top')
      .map(s => ({ ...s, bounds: { ...s.bounds } }));
    this.boundsId = boundsId;
    this.bounds = bounds === undefined ? undefined : { ...bounds };
  }

  public clear(): void { this.candidates = []; this.boundsId = undefined; this.bounds = undefined; }

  public findLanding(
    previous: Vector2Dto, next: Vector2Dto, live: readonly ExternalWindowSurface[],
    environment: EnvironmentSnapshot, insets: CollisionInsets,
  ): { readonly surface: WindowTop; readonly root: Vector2Dto } | null {
    if (environment.screenBounds.id !== this.boundsId) { this.clear(); return null; }
    const bounds = environment.screenBounds;
    if (this.bounds !== undefined && (bounds.x !== this.bounds.x || bounds.y !== this.bounds.y
        || bounds.width !== this.bounds.width || bounds.height !== this.bounds.height)) { this.clear(); return null; }
    this.bounds = { ...bounds };
    // Keep initial identity, but use each accepted live geometry until permanent loss.
    const liveById = new Map(live.map(s => [s.id, s] as const));
    this.candidates = this.candidates.flatMap(candidate => {
      const surface = liveById.get(candidate.id);
      if (!isExternalSurface(surface) || surface.kind !== 'window_top') return [];
      // A newly observed top above the root must not catch it retroactively.
      if (surface.supportY !== candidate.supportY && surface.supportY < previous.y) return [];
      return [{ ...surface, bounds: { ...surface.bounds } }];
    });
    if (![previous.x, previous.y, next.x, next.y].every(Number.isFinite) || next.y <= previous.y) return null;
    const floorY = calculateRootCollisionRange(environment.screenBounds, insets).maxY;
    const floorFraction = previous.y <= floorY && next.y >= floorY
      ? (floorY - previous.y) / (next.y - previous.y) : Infinity;
    const hits = this.candidates.flatMap(surface => {
      if (previous.y > surface.supportY || next.y < surface.supportY) return [];
      const fraction = (surface.supportY - previous.y) / (next.y - previous.y);
      const root = { x: previous.x + (next.x - previous.x) * fraction, y: surface.supportY };
      return fraction < floorFraction && root.x >= surface.bounds.x && root.x <= surface.bounds.x + surface.bounds.width
        && isRootInsideEnvironment(root, environment, insets) ? [{ surface, root, fraction }] : [];
    }).sort((a, b) => a.fraction - b.fraction || a.surface.id.localeCompare(b.surface.id));
    const hit = hits[0];
    if (hit === undefined) { if (Number.isFinite(floorFraction)) this.clear(); return null; }
    this.clear();
    return hit;
  }
}
