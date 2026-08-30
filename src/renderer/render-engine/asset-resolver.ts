import type { AnimationIntent, AnyAnimationIntentKind } from '../../domain/animation/animation-intent';
import {
  DEFAULT_FACE_PIVOT,
  DEFAULT_SPRITE_PIVOT,
  type NormalizedSpriteAnimationDef,
  type NormalizedSpriteManifest,
  type ProceduralBlushDef,
  type RenderBlendMode,
  type ResolvedAnimationClip,
  type ResolvedBodyTrack,
  type ResolvedOverlayTrack,
  type SpriteLayerCategory,
  type SpritePoint,
} from './types';

const DEFAULT_VIEWPORT = { width: 512, height: 512 };
const ZERO_POINT: SpritePoint = { x: 0, y: 0 };

const BODY_KEYS: Readonly<Record<AnyAnimationIntentKind, string>> = {
  walk: 'body_walk',
  idle_blink: 'body_idle',
  settle: 'body_idle',
  thinking_loop: 'body_thinking',
  talking: 'body_thinking',
  happy_reaction: 'body_petting',
  confused_reaction: 'body_scared',
  spook: 'body_scared',
  wave: 'body_wave',
  celebrate: 'body_celebrate',
  bored: 'body_bored',
  sleep_start: 'body_sleep_trans',
  sleep_loop: 'body_sleep',
  wake_up: 'body_land',
  land: 'body_land',
  dragged: 'body_dragged',
  sit: 'body_sit',
  stand_up: 'body_stand_up',
  lie_down: 'body_lie',
  get_up: 'body_stand_up',
  run: 'body_run',
  jump: 'body_jump',
  fall: 'body_fall',
  crawl: 'body_climb_wall',
  climb_wall: 'body_climb_wall',
  hang_ceiling: 'body_ceiling_hang',
  crash_landing: 'body_crash_splat',
};

const FACE_KEYS: Readonly<Partial<Record<NonNullable<AnimationIntent['expressionHint']>, string>>> = {
  happy: 'face_happy',
  sleepy: 'face_sleep',
  surprised: 'face_shocked',
  shocked: 'face_shocked',
  curious: 'face_curious',
  thinking: 'face_thinking',
  angry: 'face_angry',
  sad: 'face_sad',
  talking: 'face_talking',
  gaze: 'face_gaze',
  pout: 'face_pout',
  winking: 'face_winking',
  dizzy: 'face_dizzy',
  flirty: 'face_flirty',
};

const EXPRESSION_KEYS: Readonly<Partial<Record<NonNullable<AnimationIntent['expressionHint']>, string>>> = {
  winking: 'expression_wink',
  pout: 'expression_pout',
};

const PROP_CONFIG: Readonly<Record<Exclude<NonNullable<AnimationIntent['propHint']>, 'none'>, {
  readonly key: string;
  readonly id: 'prop_pillow' | 'prop_heart' | 'prop_question' | 'prop_sparkle';
  readonly zIndex: number;
  readonly blendMode: RenderBlendMode;
  readonly playbackMode: 'hold' | 'loop';
}>> = {
  pillow: { key: 'prop_pillow', id: 'prop_pillow', zIndex: 40, blendMode: 'normal', playbackMode: 'hold' },
  heart: { key: 'prop_heart', id: 'prop_heart', zIndex: 41, blendMode: 'additive', playbackMode: 'hold' },
  question: { key: 'prop_question', id: 'prop_question', zIndex: 42, blendMode: 'normal', playbackMode: 'hold' },
  sparkle: { key: 'prop_sparkle', id: 'prop_sparkle', zIndex: 43, blendMode: 'screen', playbackMode: 'loop' },
};

export interface AssetResolverOptions {
  readonly enableFaceOverlays?: boolean;
}

/** Resolves semantic intents to presentation-ready, framework-neutral animation clips. */
export class AssetResolver {
  private readonly enableFaceOverlays: boolean;

  constructor(
    private readonly manifest: NormalizedSpriteManifest,
    options: AssetResolverOptions = {}
  ) {
    this.enableFaceOverlays = options.enableFaceOverlays ?? true;
  }

  resolve(intent: AnimationIntent): ResolvedAnimationClip {
    const body = this.resolveBody(intent);
    const face = this.resolveFace(intent, body);
    const expression = this.resolveExpression(intent);
    const prop = this.resolveProp(intent);
    const rootPivot = body.pivot ?? DEFAULT_SPRITE_PIVOT;
    const hasBlush = intent.expressionHint === 'blush' || intent.emotionalTone === 'flustered' || intent.emotionalTone === 'shy';

    return {
      key: body.key,
      viewport: body.canvasSize ?? DEFAULT_VIEWPORT,
      rootPivot,
      transform: { flipX: false, scale: 1 },
      body: toBodyTrack(body),
      ...(face === undefined ? {} : { face }),
      ...(expression === undefined ? {} : { expression }),
      ...(hasBlush ? { proceduralBlush: createBlush(rootPivot) } : {}),
      ...(prop === undefined ? {} : { props: [prop] }),
    };
  }

  /** Exact-key playback for the Debug HUD inspector; production intent resolution remains unchanged. */
  resolveDebugSelection(bodyKey: string, faceKey?: string): ResolvedAnimationClip {
    const body = selectAnimation(this.manifest.animations[bodyKey], 'body')
      ?? selectAnimation(this.manifest.animations.body_idle, 'body')
      ?? systemBody();
    const faceAnimation = faceKey === undefined
      ? undefined
      : selectAnimation(this.manifest.animations[faceKey], 'face');
    const rootPivot = body.pivot ?? DEFAULT_SPRITE_PIVOT;
    const face = faceAnimation === undefined
      ? undefined
      : toDebugFullCanvasFaceTrack(faceAnimation, rootPivot);

    return {
      key: faceAnimation === undefined ? body.key : `${body.key}::${faceAnimation.key}`,
      viewport: body.canvasSize ?? DEFAULT_VIEWPORT,
      rootPivot,
      transform: { flipX: false, scale: 1 },
      body: toBodyTrack(body),
      ...(face === undefined
        ? {}
        : { face }),
    };
  }

  getAnimationKeys(layer: SpriteLayerCategory): string[] {
    return Object.values(this.manifest.animations)
      .filter((animation) => animation.layer === layer)
      .map((animation) => animation.key)
      .sort((left, right) => left.localeCompare(right));
  }

  private resolveBody(intent: AnimationIntent): NormalizedSpriteAnimationDef {
    const preferredKey = BODY_KEYS[intent.kind] ?? 'body_idle';
    const specialised = this.manifest.animations[`${preferredKey}_${intent.emotionalTone}`];
    const preferred = this.manifest.animations[preferredKey];
    const idle = this.manifest.animations.body_idle;
    return selectAnimation(specialised, 'body') ?? selectAnimation(preferred, 'body') ?? selectAnimation(idle, 'body') ?? systemBody();
  }

  private resolveFace(
    intent: AnimationIntent,
    body: NormalizedSpriteAnimationDef
  ): (ResolvedOverlayTrack & { readonly category: 'face' }) | undefined {
    if (!this.enableFaceOverlays) return undefined;
    const compatibility = body.faceOverlay;
    if (compatibility?.mode !== 'overlay' || compatibility.anchor === undefined) return undefined;

    const requestedKey = intent.expressionHint === undefined ? undefined : FACE_KEYS[intent.expressionHint];
    const allowedKeys = compatibility.allowedFaceKeys ?? [];
    const requestedAnimation = requestedKey !== undefined && allowedKeys.includes(requestedKey)
      ? selectAnimation(this.manifest.animations[requestedKey], 'face')
      : undefined;
    const fallbackAnimation = compatibility.fallback === 'none'
      ? undefined
      : selectAnimation(this.manifest.animations[compatibility.fallback], 'face');
    const animation = requestedAnimation ?? fallbackAnimation;
    if (animation === undefined) return undefined;
    const isDiscreteGaze = animation.key === 'face_gaze';
    return {
      ...toOverlayTrack(animation, 'face', 'face', 20, isDiscreteGaze ? 'hold' : 'loop', 'normal'),
      anchorName: compatibility.anchor,
      ...(isDiscreteGaze ? {
        fixedFrameIndex: gazeFrameIndex(intent.gazeDirection),
      } : {}),
    };
  }

  private resolveExpression(intent: AnimationIntent): (ResolvedOverlayTrack & { readonly category: 'expression' }) | undefined {
    const key = intent.expressionHint === undefined ? undefined : EXPRESSION_KEYS[intent.expressionHint];
    const animation = key === undefined ? undefined : selectAnimation(this.manifest.animations[key], 'expression');
    return animation === undefined
      ? undefined
      : toOverlayTrack(animation, 'expression', 'expression', 21, 'hold', 'normal');
  }

  private resolveProp(intent: AnimationIntent): (ResolvedOverlayTrack & { readonly category: 'props' }) | undefined {
    if (intent.propHint === undefined || intent.propHint === 'none') return undefined;
    const config = PROP_CONFIG[intent.propHint];
    const animation = selectAnimation(this.manifest.animations[config.key], 'props');
    return animation === undefined
      ? undefined
      : toOverlayTrack(animation, 'props', config.id, config.zIndex, config.playbackMode, config.blendMode);
  }
}

function gazeFrameIndex(direction: AnimationIntent['gazeDirection']): number {
  switch (direction) {
    case 'left': return 0;
    case 'right': return 1;
    case 'up': return 2;
    case 'down':
    default: return 3;
  }
}

function toDebugFullCanvasFaceTrack(
  animation: NormalizedSpriteAnimationDef,
  rootPivot: SpritePoint
): ResolvedOverlayTrack & { readonly category: 'face' } {
  const track = toOverlayTrack(animation, 'face', 'face', 20, 'loop', 'normal');
  return {
    ...track,
    pivot: rootPivot,
    offset: ZERO_POINT,
    frames: track.frames.map((frame) => ({ ...frame, pivot: rootPivot })),
  };
}

function selectAnimation(
  animation: NormalizedSpriteAnimationDef | undefined,
  layer: SpriteLayerCategory
): NormalizedSpriteAnimationDef | undefined {
  return animation?.layer === layer ? animation : undefined;
}

function toBodyTrack(animation: NormalizedSpriteAnimationDef): ResolvedBodyTrack {
  return {
    id: 'base_body',
    category: 'body',
    animationKey: animation.key,
    frames: animation.frames,
    fps: animation.fps,
    zIndex: 10,
    blendMode: 'normal',
    pivot: animation.pivot ?? DEFAULT_SPRITE_PIVOT,
    offset: ZERO_POINT,
    opacity: 1,
    defaultAnchors: animation.defaultAnchors,
    frameMeta: animation.frameMeta,
  };
}

function toOverlayTrack<TCategory extends 'face' | 'expression' | 'props'>(
  animation: NormalizedSpriteAnimationDef,
  category: TCategory,
  id: string,
  zIndex: number,
  playbackMode: 'hold' | 'loop',
  blendMode: RenderBlendMode
): ResolvedOverlayTrack & { readonly category: TCategory } {
  const defaultPivot = category === 'face' || category === 'expression' ? DEFAULT_FACE_PIVOT : DEFAULT_SPRITE_PIVOT;
  return {
    id: id as ResolvedOverlayTrack['id'],
    category,
    animationKey: animation.key,
    frames: animation.frames,
    fps: animation.fps,
    zIndex,
    playbackMode,
    blendMode,
    pivot: animation.pivot ?? defaultPivot,
    offset: ZERO_POINT,
    opacity: 1,
    defaultAnchors: animation.defaultAnchors,
    frameMeta: animation.frameMeta,
  };
}

function createBlush(rootPivot: SpritePoint): ProceduralBlushDef {
  return {
    id: 'procedural_blush',
    intensity: 1,
    radius: 18,
    opacity: 0.8,
    color: '#ff4d8d',
    blendMode: 'normal',
    leftCheek: { x: rootPivot.x - 48, y: rootPivot.y - 12 },
    rightCheek: { x: rootPivot.x + 48, y: rootPivot.y - 12 },
  };
}

function systemBody(): NormalizedSpriteAnimationDef {
  return {
    key: 'system_default_idle',
    category: 'body/idle',
    layer: 'body',
    frames: [{ source: 'system://wisp/default_idle.svg', durationMs: 1000, pivot: DEFAULT_SPRITE_PIVOT }],
    framesCount: 1,
    fps: 1,
    pivot: DEFAULT_SPRITE_PIVOT,
    canvasSize: DEFAULT_VIEWPORT,
    tags: [],
  };
}
