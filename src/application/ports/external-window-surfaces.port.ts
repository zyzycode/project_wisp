import type { ExternalWindowSurface } from '../../domain/behavior/surface-kinematics';

/** Full replacement observation, in global DIP; no native identifiers or metadata. */
export type ExternalWindowSurfacesSnapshot = {
  /** Main monotonic time at request start, never refreshed by reading the cache. */
  readonly capturedAtMs: number;
  /** Strictly increasing within this port instance, including recovery. */
  readonly revision: number;
} & (
  | { readonly capability: 'available'; readonly surfaces: readonly ExternalWindowSurface[] }
  | {
      readonly capability: 'unavailable';
      readonly reason: 'unsupported' | 'initializing' | 'bridge_failed' | 'stale';
      readonly surfaces: readonly [];
    }
);

/** Target AUTO-A07 port. Infrastructure owns discovery; Application selects support. */
export interface ExternalWindowSurfacesPort {
  /** Non-blocking cached observation; initial value is unavailable, never fabricated geometry. */
  getSnapshot(): ExternalWindowSurfacesSnapshot;
  /** Full snapshots, ordered by revision; unsubscribe is idempotent. */
  subscribe(listener: (snapshot: ExternalWindowSurfacesSnapshot) => void): () => void;
  /** Stops sampling, closes the helper and releases callbacks; idempotent. */
  dispose(): void;
}
