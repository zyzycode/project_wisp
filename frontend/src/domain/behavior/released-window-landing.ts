import { isExternalSurface, isRootInsideEnvironment } from './external-surface-support';
import type { CollisionInsets, Vector2Dto } from './motion-engine';
import type { EnvironmentSnapshot, ExternalWindowSurface } from './surface-kinematics';

type WindowTop = Extract<ExternalWindowSurface, { kind: 'window_top' }>;

/** Only windows observed at this user release can catch its subsequent fall. */
export class ReleasedWindowLanding {
  private candidates: readonly WindowTop[] = [];
  private boundsId: string | undefined;

  public begin(surfaces: readonly ExternalWindowSurface[], boundsId: string): void {
    this.candidates = surfaces.filter((s): s is WindowTop => isExternalSurface(s) && s.kind === 'window_top')
      .map(s => ({ ...s, bounds: { ...s.bounds } }));
    this.boundsId = boundsId;
  }

  public clear(): void { this.candidates = []; this.boundsId = undefined; }

  public findLanding(
    previous: Vector2Dto, next: Vector2Dto, live: readonly ExternalWindowSurface[],
    environment: EnvironmentSnapshot, insets: CollisionInsets,
  ): { readonly surface: WindowTop; readonly root: Vector2Dto } | null {
    if (environment.screenBounds.id !== this.boundsId) { this.clear(); return null; }
    // Loss or a geometry change removes a candidate permanently for this release.
    const liveById = new Map(live.map(s => [s.id, s] as const));
    this.candidates = this.candidates.filter(candidate => {
      const s = liveById.get(candidate.id);
      return isExternalSurface(s) && s.kind === 'window_top' && s.bounds.x === candidate.bounds.x
        && s.bounds.y === candidate.bounds.y && s.bounds.width === candidate.bounds.width
        && s.bounds.height === candidate.bounds.height;
    });
    if (![previous.x, previous.y, next.x, next.y].every(Number.isFinite) || next.y <= previous.y) return null;
    const hits = this.candidates.flatMap(surface => {
      if (previous.y > surface.supportY || next.y < surface.supportY) return [];
      const fraction = (surface.supportY - previous.y) / (next.y - previous.y);
      const root = { x: previous.x + (next.x - previous.x) * fraction, y: surface.supportY };
      return root.x >= surface.bounds.x && root.x <= surface.bounds.x + surface.bounds.width
        && isRootInsideEnvironment(root, environment, insets) ? [{ surface, root, fraction }] : [];
    }).sort((a, b) => a.fraction - b.fraction || a.surface.id.localeCompare(b.surface.id));
    const hit = hits[0];
    if (hit === undefined) return null;
    this.clear();
    return hit;
  }
}
