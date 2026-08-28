export const DEFAULT_SPRITE_FPS = 8;
export const DEFAULT_SPRITE_PIVOT: SpritePoint = { x: 256, y: 460 };

export type SpriteLayerCategory = 'body' | 'face' | 'expression' | 'props';
export type SpriteAnimationCategory =
  | `body/${string}`
  | `face/${string}`
  | `faces/${string}`
  | `expression/${string}`
  | `props/${string}`
  | `fx/${string}`;
export type SpriteAnimationKey = string;
export type SynthesizedEmotionalTone =
  | 'shy'
  | 'sleepy'
  | 'playful'
  | 'curious'
  | 'neutral'
  | 'affectionate'
  | 'flustered';

export interface SpritePoint {
  readonly x: number;
  readonly y: number;
}

export interface SpriteRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SpriteFrameDef {
  readonly source: string;
  readonly sourceRect?: SpriteRect;
  readonly bounds?: SpriteRect;
  readonly durationMs?: number;
  readonly pivot?: SpritePoint;
}

export interface SpriteAnimationDef {
  readonly category: SpriteAnimationCategory;
  readonly layer?: SpriteLayerCategory;
  readonly frames: readonly (string | SpriteFrameDef)[];
  readonly framesCount?: number;
  readonly fps?: number;
  readonly pivot?: SpritePoint;
  readonly canvasSize?: { readonly width: number; readonly height: number };
  readonly sourceRect?: SpriteRect;
  readonly sourceFile?: string;
  readonly emotionalTone?: SynthesizedEmotionalTone;
  readonly tags?: readonly string[];
}

export interface SpriteManifest {
  readonly schemaVersion?: 1;
  readonly animations?: Readonly<Record<SpriteAnimationKey, SpriteAnimationDef>>;
  readonly [animationKey: string]: unknown;
}

export interface NormalizedSpriteFrameDef extends SpriteFrameDef {
  readonly durationMs: number;
  readonly pivot: SpritePoint;
}

export interface NormalizedSpriteAnimationDef {
  readonly key: SpriteAnimationKey;
  readonly category: Exclude<SpriteAnimationCategory, `faces/${string}` | `fx/${string}`>;
  readonly layer: SpriteLayerCategory;
  readonly frames: readonly NormalizedSpriteFrameDef[];
  readonly framesCount: number;
  readonly fps: number;
  readonly pivot: SpritePoint;
  readonly canvasSize?: { readonly width: number; readonly height: number };
  readonly sourceFile?: string;
  readonly emotionalTone?: SynthesizedEmotionalTone;
  readonly tags: readonly string[];
}

export interface NormalizedSpriteManifest {
  readonly schemaVersion: 1;
  readonly animations: Readonly<Record<SpriteAnimationKey, NormalizedSpriteAnimationDef>>;
}

export type RenderLayerId =
  | 'base_body'
  | 'face'
  | 'expression'
  | 'procedural_blush'
  | 'prop_pillow'
  | 'prop_heart'
  | 'prop_question'
  | 'prop_sparkle';
export type NonProceduralRenderLayerId = Exclude<RenderLayerId, 'procedural_blush'>;
export type RenderBlendMode = 'normal' | 'multiply' | 'screen' | 'additive';
export interface RenderableFrameDef extends SpriteFrameDef {
  readonly source: string;
}

export interface RenderLayerBase {
  readonly id: NonProceduralRenderLayerId;
  readonly category: SpriteLayerCategory;
  readonly zIndex: number;
  readonly animationKey?: SpriteAnimationKey;
  readonly pivot: SpritePoint;
  readonly offset: SpritePoint;
  readonly opacity: number;
  readonly blendMode: RenderBlendMode;
}

export interface VisibleRenderLayerDef extends RenderLayerBase {
  readonly visible: true;
  readonly frame: RenderableFrameDef;
}

export interface HiddenRenderLayerDef extends RenderLayerBase {
  readonly visible: false;
  readonly frame?: RenderableFrameDef;
}

export type RenderLayerDef = VisibleRenderLayerDef | HiddenRenderLayerDef;

export interface ProceduralBlushDef {
  readonly id: 'procedural_blush';
  readonly intensity: number;
  readonly blendMode: 'normal';
  readonly color: string;
  readonly leftCheek: SpritePoint;
  readonly rightCheek: SpritePoint;
  readonly radius: number;
  readonly opacity: number;
}

export interface RenderPresentationState {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly rootPivot: SpritePoint;
  readonly transform: { readonly flipX: boolean; readonly scale: number };
  readonly layers: readonly RenderLayerDef[];
  readonly proceduralBlush?: ProceduralBlushDef;
}

export type TrackPlaybackMode = 'loop' | 'hold' | 'once';

export interface ResolvedTrackBase {
  readonly id: NonProceduralRenderLayerId;
  readonly category: SpriteLayerCategory;
  readonly animationKey: SpriteAnimationKey;
  readonly frames: readonly RenderableFrameDef[];
  readonly fps?: number;
  readonly zIndex: number;
  readonly pivot?: SpritePoint;
  readonly offset?: SpritePoint;
  readonly opacity?: number;
  readonly blendMode?: RenderBlendMode;
}

export interface ResolvedBodyTrack extends ResolvedTrackBase {
  readonly id: 'base_body';
  readonly category: 'body';
  readonly playbackMode?: never;
}

export interface ResolvedOverlayTrack extends ResolvedTrackBase {
  readonly category: 'face' | 'expression' | 'props';
  readonly playbackMode?: TrackPlaybackMode;
}

export interface ResolvedAnimationClip {
  readonly key: SpriteAnimationKey;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly rootPivot: SpritePoint;
  readonly transform: { readonly flipX: boolean; readonly scale: number };
  readonly body: ResolvedBodyTrack;
  readonly face?: ResolvedOverlayTrack & { readonly category: 'face' };
  readonly expression?: ResolvedOverlayTrack & { readonly category: 'expression' };
  readonly props?: readonly (ResolvedOverlayTrack & { readonly category: 'props' })[];
  readonly proceduralBlush?: ProceduralBlushDef;
}

export type AnimationLoopMode =
  | { type: 'none' }
  | { type: 'until_replaced' }
  | { type: 'bounded'; count: number };

export interface AnimationCompletedEvent {
  readonly clipKey: string;
  readonly loopCount: number;
  readonly sessionElapsedMs: number;
}

export type AnimationCompletedListener = (event: AnimationCompletedEvent) => void;

export interface ICharacterRenderer {
  render(state: RenderPresentationState): void;
  preload?(sources: readonly string[]): Promise<void>;
  destroy(): void;
}

export interface IAnimationPlayer {
  play(clip: ResolvedAnimationClip, loopMode: AnimationLoopMode): void;
  tick(deltaMs: number): void;
  onCompleted(listener: AnimationCompletedListener): () => void;
  destroy(): void;
}
