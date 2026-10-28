/** Personal OpenAI setup, consumed by Main; never part of semantic AI requests. */
export type UserAIKeyStoreFailure = 'secure_storage_unavailable' | 'storage_error';
export type UserAIKeyStoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: UserAIKeyStoreFailure };

/** Plaintext is Main-only, transient, never returned through a read IPC method. */
export interface IUserAIKeyStore {
  isAvailable(): Promise<boolean>;
  load(): Promise<UserAIKeyStoreResult<string | null>>;
  save(apiKey: string): Promise<UserAIKeyStoreResult<void>>;
  remove(): Promise<UserAIKeyStoreResult<void>>;
}

/** Single bounded stdin bootstrap to a Main-owned local backend child. */
export interface LocalAIBackendBootstrap {
  readonly apiKey: string;
  readonly sessionToken: string;
  readonly ledgerPath: string;
}

/** Only this control record may be emitted on managed-child stdout. */
export interface LocalAIBackendReady {
  readonly kind: 'ready';
  readonly port: number;
}

export type LocalAIBackendFailure = 'runtime_unavailable' | 'startup_failed' | 'startup_timeout';
export type LocalAIBackendStartResult =
  | { readonly ok: true; readonly port: number }
  | { readonly ok: false; readonly code: LocalAIBackendFailure };

/** Main owns token generation, routing and lifecycle; no process handles cross this port. */
export interface ILocalAIBackend {
  start(bootstrap: LocalAIBackendBootstrap): Promise<LocalAIBackendStartResult>;
  stop(): Promise<void>;
}
