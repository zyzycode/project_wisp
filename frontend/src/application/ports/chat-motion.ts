/** Local user command boundary; never a provider/wire command or coordinate payload. */
export type ChatMotionCommand =
  | { readonly kind: 'move'; readonly direction: 'left' | 'right' }
  | { readonly kind: 'stop' };

export type ChatMotionRecognition =
  | { readonly kind: 'command'; readonly command: ChatMotionCommand }
  | { readonly kind: 'clarify' }
  | { readonly kind: 'none' };

export interface ChatMotionRequest {
  readonly requestId: string;
  readonly conversationId: string;
  readonly generation: number;
  readonly command: ChatMotionCommand;
}

export type ChatMotionRejection =
  | 'sleeping' | 'low_energy' | 'overloaded' | 'forced_motion'
  | 'unavailable' | 'no_support' | 'edge' | 'invalid_request';

export type ChatMotionCancellation =
  | 'stop' | 'replaced' | 'user_input' | 'forced_motion' | 'critical_need'
  | 'environment_changed' | 'reset' | 'disposed' | 'timeout';

export type ChatMotionReceipt =
  | { readonly status: 'started'; readonly requestId: string; readonly runId: string }
  | { readonly status: 'stopped'; readonly requestId: string; readonly hadActiveRun: boolean }
  | { readonly status: 'rejected'; readonly requestId: string; readonly reason: ChatMotionRejection };

/** Terminal Motion/Runner facts, correlated with the run; not Skin acknowledgements. */
export type ChatMotionTerminal =
  | { readonly status: 'completed'; readonly requestId: string; readonly runId: string }
  | { readonly status: 'cancelled'; readonly requestId: string; readonly runId: string; readonly reason: ChatMotionCancellation };

export interface IChatMotion {
  submit(request: ChatMotionRequest): ChatMotionReceipt;
  cancel(reason: ChatMotionCancellation): void;
}
