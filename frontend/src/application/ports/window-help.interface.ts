/** Target #131. Local normalized geometry, never server/native-window metadata. */
export type WindowHelpRegion = 'upper_left' | 'upper_center' | 'upper_right'
  | 'middle_left' | 'middle_center' | 'middle_right'
  | 'lower_left' | 'lower_center' | 'lower_right';
export interface WindowHelpTargetPreviewDTO {
  readonly region: WindowHelpRegion;
  /** Clipped screen-relative rectangle, finite0..1; width/height positive. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
/** Main-only tracker identity, not OS process incarnation/owner proof.
 * The tracker subscribes to the same existing port; stable fresh polls preserve epochs.
 */
export interface VerifiedWindowHelpTarget {
  readonly surfaceId: string;
  /** Application continuity epoch for port replacement/unavailable/recovery/target discontinuity. */
  readonly sourceEpoch: number;
  /** Main consent/profile policy epoch, not metadata supplied by the window observer. */
  readonly policyGeneration: number;
  readonly geometrySignature: string;
  readonly capturedAtMs: number;
  readonly preview: WindowHelpTargetPreviewDTO;
}
/** Produced by an actual resolved P4 Explore choice, never preview/caller input. */
export interface WindowHelpChoice {
  readonly decisionSequence: number;
  readonly generation: number;
  readonly selectedAtMs: number;
  readonly reason: 'resolved_explore_needs_manual_support';
  readonly target: VerifiedWindowHelpTarget;
}
export type WindowHelpOutcome = 'fulfilled' | 'declined' | 'unanswered' | 'cancelled' | 'target_lost';
export type WindowHelpStatusDTO =
  | { readonly phase: 'none' }
  | { readonly phase: 'preparing' | 'waiting' | 'assisting'; readonly requestId: string;
      readonly target: WindowHelpTargetPreviewDTO; readonly expiresAtMs: number }
  | { readonly phase: 'closed'; readonly requestId: string; readonly outcome: WindowHelpOutcome };
export interface WindowHelpDeclineCommandDTO { readonly streamId: string; readonly requestId: string }
/** Only Main interprets authoritative accepted drag/release; Renderer cannot claim success. */
export interface IWindowHelpControls {
  decline(command: WindowHelpDeclineCommandDTO): Promise<
    { readonly ok: true } | { readonly ok: false; readonly code: 'invalid_input' | 'stale' }
  >;
}
