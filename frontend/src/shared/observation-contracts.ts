export interface ObservationApplicationDTO { readonly appKey: string; readonly alias: string; readonly category: 'editor' | 'other' | 'unknown'; readonly excluded: boolean; }
export type ObservationUnavailableReasonDTO = 'backend_unavailable' | 'disabled' | 'paused' | 'unsupported' | 'initializing' | 'excluded' | 'permission_denied' | 'bridge_failed' | 'stale';
export interface ObservationSettingsDTO {
  readonly generation: number;
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly status: 'off' | 'paused' | 'available' | 'unavailable';
  readonly reason: ObservationUnavailableReasonDTO | null;
  readonly applications: readonly ObservationApplicationDTO[];
  readonly previewOpen: boolean;
  readonly preview: { readonly appName: string; readonly windowTitle: string } | null;
}
export type ObservationCommandDTO = { readonly streamId: string; readonly generation: number } & (
  { readonly type: 'get' | 'pick' | 'enable' | 'disable' | 'pause' | 'resume' | 'clear' | 'preview-open' | 'preview-close' }
  | { readonly type: 'remove'; readonly appKey: string }
  | { readonly type: 'exclude'; readonly appKey: string; readonly excluded: boolean }
);
export interface ObservationBridge { observationCommand(command: ObservationCommandDTO): Promise<ObservationSettingsDTO>; }
