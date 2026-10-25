/** Scalar system input idle only; no key, pointer, application, or screen contents. */
export type SystemIdleReading =
  | { readonly status: 'available'; readonly idleMs: number }
  | {
      readonly status: 'unavailable';
      readonly reason: 'unsupported' | 'unconfirmed' | 'read_failed' | 'inactive_session' | 'disposed';
    };

export type SystemIdleLifecycleEvent =
  | 'suspend' | 'resume' | 'lock' | 'unlock' | 'session_deactivated' | 'session_activated';

/** Main owns bounded sampling, receive time, generation, and subscription cleanup. */
export interface SystemIdlePort {
  /** Fresh read; idleMs is a positive safe integer in milliseconds, divisible by 1000. */
  read(): SystemIdleReading;
  /** No replay; unsubscribe is idempotent. Events invalidate continuity, never imply return. */
  subscribeLifecycle(listener: (event: SystemIdleLifecycleEvent) => void): () => void;
  /** Idempotent terminal cleanup; no native listeners or callbacks survive disposal. */
  dispose(): void;
}
