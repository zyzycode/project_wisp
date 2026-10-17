/** OBS-A02 metadata is RAM-only and never enters Domain, history or memory. */
export type ObservationCategory = 'editor' | 'other' | 'unknown';
export interface ObservationApplication {
  readonly appKey: string;
  readonly alias: string;
  readonly category: ObservationCategory;
  readonly excluded: boolean;
}
export interface ObservationPolicy {
  readonly generation: number;
  readonly active: boolean;
  readonly applications: readonly ObservationApplication[];
}
export type ObservationUnavailableReason = 'disabled' | 'paused' | 'unsupported' | 'initializing' | 'excluded' | 'permission_denied' | 'bridge_failed' | 'stale';
export type ActiveApplicationObservationSnapshot = {
  readonly policyGeneration: number;
  readonly revision: number;
  readonly capturedAtMs: number;
} & ({ readonly capability: 'unavailable'; readonly reason: ObservationUnavailableReason } | {
  readonly capability: 'available'; readonly appKey: string; readonly episodeToken: string; readonly sourceToken: string;
  readonly appName: string; readonly windowTitle: string; readonly category: ObservationCategory;
});
export interface ActiveApplicationObservationPort {
  getSnapshot(): ActiveApplicationObservationSnapshot;
  subscribe(listener: (snapshot: ActiveApplicationObservationSnapshot) => void): () => void;
  replacePolicy(policy: ObservationPolicy): void;
  pause(): void;
  dispose(): void;
}
