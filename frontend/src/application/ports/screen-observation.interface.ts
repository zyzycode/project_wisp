import type { BackendScreenImage, BackendScreenObservationCapability,
  ScreenObservationEvidence } from './backend-screen-observation-contract';

/** One-shot flow identity; pixels remain outside Domain and persistent context. */
export interface ScreenObservationContext {
  readonly streamId: string;
  readonly conversationId: string;
  readonly requestId: string;
  readonly generation: number;
}

/** Normalized region on the sole display; native identity/topology stay Infrastructure-owned. */
export interface ScreenObservationRegion {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ScreenCaptureAuthorization {
  readonly context: ScreenObservationContext;
  readonly confirmationId: string;
  /** Explicit local consent includes transient FULL single-screen RAM before cropping. */
  readonly scope: 'one_full_single_screen_frame_for_crop';
  readonly region: ScreenObservationRegion;
  readonly expiresAtMs: number;
}

/** Main-owned canonical JPEG; Renderer receives only this crop, never the full frame. */
export interface PreparedScreenObservation {
  readonly context: ScreenObservationContext;
  readonly previewId: string;
  readonly digest: string;
  readonly preparedAtMs: number;
  readonly expiresAtMs: number;
  readonly image: BackendScreenImage;
}

/** Minted only after Main's native send confirmation for the exact preview bytes/digest. */
export interface ScreenSendAuthorization {
  readonly context: ScreenObservationContext;
  readonly previewId: string;
  readonly digest: string;
  readonly confirmationId: string;
  readonly policyRevision: 'screen-openai-2026-11';
  readonly authorizedAtMs: number;
  readonly expiresAtMs: number;
}

export type ScreenCaptureAvailability =
  | { readonly status: 'available' }
  | { readonly status: 'unavailable'; readonly reason: 'unsupported_platform' | 'multiple_displays'
      | 'permission_denied' | 'source_unavailable' };

/** One first-party encoded frame/crop, no stream; Main owns consent and lifecycle checks. */
export interface IScreenObservationCapture {
  availability(): ScreenCaptureAvailability;
  capture(authorization: ScreenCaptureAuthorization, signal: AbortSignal): Promise<PreparedScreenObservation>;
  /** Release references/resources; immutable runtime buffers cannot promise secure zeroization. */
  dispose(): void;
}

/** Shares existing backend transport/auth/admission; no separate provider/network owner. */
export interface IScreenObservationProvider {
  /** Reserve the existing AI singleflight through selection/preview; no inference. */
  reserve(requestId: string): boolean;
  release(requestId: string): void;
  /** Authenticated server status; refresh before capture, cache at most 30 seconds. No inference. */
  getCapability(signal: AbortSignal): Promise<BackendScreenObservationCapability>;
  observe(prepared: PreparedScreenObservation, authorization: ScreenSendAuthorization,
    locale: 'ru' | 'en', signal: AbortSignal): Promise<ScreenObservationEvidence>;
}
