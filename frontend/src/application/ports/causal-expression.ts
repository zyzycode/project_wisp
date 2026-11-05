import type { CausalExpressionProjection } from './causal-life.interface';

/** Request-local identity. None of these ownership fields cross a wire or IPC boundary. */
export interface CausalExpressionCapture {
  readonly requestId: string;
  readonly sourceSequence: number;
  readonly signature: string;
  readonly deadlineMs: number;
  readonly expression: CausalExpressionProjection;
  /** The installed synthesizer accepts text/language only; no emotional prosody is implied. */
  readonly voiceProsody: 'neutral';
}

export interface ICausalExpressionRuntime {
  capture(requestId: string): CausalExpressionCapture | undefined;
  /** Identity check deliberately excludes the request deadline after a reply was published. */
  isCurrent(capture: CausalExpressionCapture): boolean;
}
