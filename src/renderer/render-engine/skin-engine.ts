import type { BrainVisualIntentDTO } from '../../shared/ipc-contracts';

export interface BodyVisualReflexState {
  readonly pupilOffset: { readonly x: number; readonly y: number };
  readonly transform: {
    readonly flipX: boolean;
    readonly scaleX: number;
    readonly scaleY: number;
    readonly rotationDeg: number;
  };
}

/** Renderer-local projection consumed by a Skin adapter; never crosses IPC. */
export interface BodyVisualState {
  readonly streamId: string;
  readonly revision: number;
  readonly visualIntent: Readonly<BrainVisualIntentDTO>;
  readonly visualAgeMs: number;
  readonly reflex: Readonly<BodyVisualReflexState>;
}

export interface ISkinEngine {
  init(): void;
  update(state: Readonly<BodyVisualState>): void;
  destroy(): void;
}
