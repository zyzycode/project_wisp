import type { AnimationIntent } from '../../domain/animation/animation-intent';
import {
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

const BODY_KEYS: Readonly<Record<AnimationIntent['kind'], string>> = {
  walk: 'body_walk',
  idle_blink: 'body_idle',
  settle: 'body_idle',
  thinking_loop: 'body_thinking',
  talking: 'body_thinking',
  happy_reaction: 'body_petting',
  confused_reaction: 'body_idle',
  spook: 'body_idle',
  sleep_start: 'body_sleep_trans',
  sleep_loop: 'body_sleep',
  wake_up: 'body_land',
  land: 'body_land',
  dragged: 'body_dragged',
};

const FACE_KEYS: Readonly<Partial<Record<NonNullable<AnimationIntent['expressionHint']>, string>>> = {
  happy: 'face_happy',
  sleepy: 'face_sleep',
  surprised: 'face_shocked',
  curious: 'face_thinking',
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

/** Resolves semantic intents to presentation-ready, framework-neutral animation clips. */
export class AssetResolver {
  constructor(private readonly manifest: NormalizedSpriteManifest) {}

  resolve(intent: AnimationIntent): ResolvedAnimationClip {
    const body = this.resolveBody(intent);
    const face = this.resolveFace(intent);
    const expression = this.resolveExpression(intent);
    const prop = this.resolveProp(intent);
    const rootPivot = body.pivot ?? DEFAULT_SPRITE_PIVOT;

    return {
      key: body.key,
      viewport: body.canvasSize ?? DEFAULT_VIEWPORT,
      rootPivot,
      transform: { flipX: false, scale: 1 },
      body: toBodyTrack(body),
      ...(face === undefined ? {} : { face }),
      ...(expression === undefined ? {} : { expression }),
      ...(intent.expressionHint === 'blush' ? { proceduralBlush: createBlush(rootPivot) } : {}),
      ...(prop === undefined ? {} : { props: [prop] }),
    };
  }

  private resolveBody(intent: AnimationIntent): NormalizedSpriteAnimationDef {
    const preferredKey = BODY_KEYS[intent.kind];
    const specialised = this.manifest.animations[`${preferredKey}_${intent.emotionalTone}`];
    const preferred = this.manifest.animations[preferredKey];
    const idle = this.manifest.animations.body_idle;
    return selectAnimation(specialised, 'body') ?? selectAnimation(preferred, 'body') ?? selectAnimation(idle, 'body') ?? systemBody();
  }

  private resolveFace(intent: AnimationIntent): (ResolvedOverlayTrack & { readonly category: 'face' }) | undefined {
    const key = intent.expressionHint === undefined ? undefined : FACE_KEYS[intent.expressionHint];
    const animation = key === undefined ? undefined : selectAnimation(this.manifest.animations[key], 'face');
    return animation === undefined ? undefined : toOverlayTrack(animation, 'face', 'face', 20, 'hold', 'normal');
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
    pivot: animation.pivot,
    offset: ZERO_POINT,
    opacity: 1,
    blendMode: 'normal',
  };
}

function toOverlayTrack<TCategory extends 'face' | 'expression' | 'props'>(
  animation: NormalizedSpriteAnimationDef,
  category: TCategory,
  id: 'face' | 'expression' | 'prop_pillow' | 'prop_heart' | 'prop_question' | 'prop_sparkle',
  zIndex: number,
  playbackMode: 'hold' | 'loop',
  blendMode: RenderBlendMode
): ResolvedOverlayTrack & { readonly category: TCategory } {
  return {
    id,
    category,
    animationKey: animation.key,
    frames: animation.frames,
    fps: animation.fps,
    zIndex,
    pivot: animation.pivot,
    offset: ZERO_POINT,
    opacity: 1,
    blendMode,
    playbackMode,
  };
}

function createBlush(rootPivot: SpritePoint): ProceduralBlushDef {
  return {
    id: 'procedural_blush',
    intensity: 0.65,
    blendMode: 'normal',
    color: '#ff8fab',
    leftCheek: { x: rootPivot.x - 70, y: rootPivot.y - 115 },
    rightCheek: { x: rootPivot.x + 70, y: rootPivot.y - 115 },
    radius: 26,
    opacity: 0.5,
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
    tags: [],
  };
}
