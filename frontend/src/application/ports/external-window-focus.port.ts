/** Explicit local focus capability. No model commands or native handles cross this port. */
export interface WindowFocusRequestContext {
  readonly streamId: string;
  readonly conversationId: string;
  readonly requestId: string;
  readonly generation: number;
}

/** Main-issued choice; rectangle is clipped screen-relative geometry in [0, 1]. */
export interface WindowFocusPreviewDTO {
  readonly selectionId: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface WindowFocusSelectorDTO {
  readonly selectorId: string;
  readonly expiresAtMs: number;
  /** At most 20 entries; no title, process metadata, source IDs or execution authority. */
  readonly candidates: readonly WindowFocusPreviewDTO[];
}

export interface WindowFocusOpenCommandDTO {
  readonly streamId: string;
  readonly conversationId: string;
  readonly requestId: string;
}

/** Selection requests Main's native confirmation; it does not assert consent. */
export interface WindowFocusChooseCommandDTO extends WindowFocusOpenCommandDTO {
  readonly selectorId: string;
  readonly selectionId: string;
}

/** Application observation identity, not a claim of atomic OS incarnation ownership. */
export interface WindowFocusTarget {
  readonly surfaceId: string;
  readonly sourceEpoch: number;
  readonly policyGeneration: number;
  readonly geometrySignature: string;
  readonly capturedAtMs: number;
}

/** Main-owned RAM grant, minted only after its native confirmation resolves affirmatively. */
export interface WindowFocusAuthorization {
  readonly attemptId: string;
  readonly context: WindowFocusRequestContext;
  readonly target: WindowFocusTarget;
  readonly confirmationId: string;
  readonly authorizedAtMs: number;
  readonly expiresAtMs: number;
}

/** Opaque nonce expires within 500 ms on the helper's clock; clocks are never compared. */
export interface PreparedWindowFocus {
  readonly attemptId: string;
  readonly preparedId: string;
}

export type WindowFocusRejection =
  | 'invalid_request' | 'stale_request' | 'expired' | 'declined' | 'duplicate'
  | 'target_lost' | 'target_changed' | 'unavailable' | 'session_inactive'
  | 'cancelled_before_dispatch' | 'os_denied';

export type WindowFocusUnknownReason =
  | 'timeout_after_dispatch' | 'cancelled_after_dispatch'
  | 'target_changed_after_dispatch' | 'verification_unavailable' | 'bridge_lost';

export type WindowFocusPreparation =
  | { readonly status: 'prepared'; readonly value: PreparedWindowFocus }
  | { readonly status: 'rejected'; readonly reason: WindowFocusRejection }
  | { readonly status: 'unsupported' };

export type WindowFocusOutcome =
  | { readonly status: 'success'; readonly effect: 'already_foreground' | 'focus_observed' }
  | { readonly status: 'rejected'; readonly reason: WindowFocusRejection }
  | { readonly status: 'unsupported' }
  | { readonly status: 'unknown'; readonly reason: WindowFocusUnknownReason };

/** Local UI receipt only; success is a foreground observation, not persistent focus. */
export type WindowFocusReceiptDTO = WindowFocusOutcome & { readonly attemptId: string };

/** Infrastructure shares the existing observer/helper; the observation port stays read-only. */
export interface ExternalWindowFocusPort {
  /** Fresh native revalidation without a focus side effect. */
  prepare(authorization: WindowFocusAuthorization, signal: AbortSignal): Promise<WindowFocusPreparation>;
  /** Consumes the nonce once; caller rechecks its grant immediately before dispatch. */
  commit(authorization: WindowFocusAuthorization, prepared: PreparedWindowFocus,
    signal: AbortSignal): Promise<WindowFocusOutcome>;
  /** Invalidates action state only; shared observation lifetime belongs to Main composition. */
  dispose(): void;
}

export interface WindowFocusCandidate {
  readonly target: WindowFocusTarget;
  readonly preview: Omit<WindowFocusPreviewDTO, 'selectionId'>;
}
