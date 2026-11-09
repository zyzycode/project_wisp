import type { ScreenObservationEvidence } from '../application/ports/backend-screen-observation-contract';
import type { ScreenObservationRegion } from '../application/ports/screen-observation.interface';

export interface ScreenObservationIdentity { readonly streamId: string; readonly conversationId: string }
export type ScreenObservationCommand = ScreenObservationIdentity & (
  | { readonly type: 'start' | 'read' | 'cancel' | 'send' }
  | { readonly type: 'region'; readonly region: ScreenObservationRegion });
export interface ScreenObservationPreview {
  readonly previewId: string;
  readonly dataBase64: string;
  readonly width: number;
  readonly height: number;
  readonly expiresAtMs: number;
}
export type ScreenObservationError = 'unavailable' | 'unsupported_platform' | 'multiple_displays' | 'busy' | 'cancelled' | 'timeout' | 'stale' | 'invalid_response';
export interface ScreenObservationState {
  readonly phase: 'idle' | 'selecting' | 'capture_confirmation' | 'preparing' | 'preview' | 'send_confirmation' | 'generating' | 'visible';
  readonly error: ScreenObservationError | null;
  readonly preview: ScreenObservationPreview | null;
  readonly evidence: ScreenObservationEvidence | null;
}
export interface ScreenObservationBridge {
  command(command: ScreenObservationCommand): Promise<ScreenObservationState>;
}
