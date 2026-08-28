import { describe, expect, it } from 'vitest';
import { AssetResolver, type NormalizedSpriteManifest } from '../../src/renderer/render-engine';
import { createSystemAnimationIntent } from '../../src/domain/animation/animation-intent';

const manifest: NormalizedSpriteManifest = {
  schemaVersion: 1,
  animations: {
    body_walk: animation('body_walk', 'body/walk', 'body'),
    body_idle: animation('body_idle', 'body/idle', 'body'),
    face_happy: animation('face_happy', 'face/happy', 'face'),
    expression_wink: animation('expression_wink', 'expression/wink', 'expression'),
    prop_pillow: animation('prop_pillow', 'props/pillow', 'props'),
    prop_heart: animation('prop_heart', 'props/heart', 'props'),
    prop_question: animation('prop_question', 'props/question', 'props'),
    prop_sparkle: animation('prop_sparkle', 'props/sparkle', 'props'),
  },
};

function animation(
  key: string,
  category: 'body/walk' | 'body/idle' | 'face/happy' | 'expression/wink' | 'props/pillow' | 'props/heart' | 'props/question' | 'props/sparkle',
  layer: 'body' | 'face' | 'expression' | 'props'
) {
  return {
    key,
    category,
    layer,
    frames: [0, 1, 2, 3].map((index) => ({ source: `${key}_${index}.png`, durationMs: 125, pivot: { x: 256, y: 460 } })),
    framesCount: 4,
    fps: 8,
    pivot: { x: 256, y: 460 },
    tags: [],
  } as const;
}

describe('Renderer: AssetResolver', () => {
  it('maps walk to the real body_walk track with the four frames and normative body z-index', () => {
    const clip = new AssetResolver(manifest).resolve(createSystemAnimationIntent('walk'));

    expect(clip.key).toBe('body_walk');
    expect(clip.body.zIndex).toBe(10);
    expect(clip.body.frames.map((frame) => frame.source)).toEqual([
      'body_walk_0.png', 'body_walk_1.png', 'body_walk_2.png', 'body_walk_3.png',
    ]);
  });

  it('resolves face, expression, procedural blush, and prop tracks with normative z-indexes', () => {
    const resolver = new AssetResolver(manifest);
    const happy = resolver.resolve(createSystemAnimationIntent('happy_reaction', 'neutral', { expressionHint: 'happy' }));
    const blushHeart = resolver.resolve(createSystemAnimationIntent('idle_blink', 'flustered'));
    const sparkle = resolver.resolve(createSystemAnimationIntent('walk', 'playful'));
    const wink = resolver.resolve(createSystemAnimationIntent('walk', 'playful', { expressionHint: 'winking', propHint: 'none' }));

    expect(happy.face).toMatchObject({ id: 'face', category: 'face', zIndex: 20 });
    expect(wink.expression).toMatchObject({ id: 'expression', category: 'expression', zIndex: 21 });
    expect(blushHeart.proceduralBlush?.id).toBe('procedural_blush');
    expect(blushHeart.props?.[0]).toMatchObject({ id: 'prop_heart', zIndex: 41, blendMode: 'additive' });
    expect(sparkle.props?.[0]).toMatchObject({ id: 'prop_sparkle', zIndex: 43, playbackMode: 'loop' });
  });

  it.each([
    ['pillow', 'prop_pillow', 40],
    ['heart', 'prop_heart', 41],
    ['question', 'prop_question', 42],
    ['sparkle', 'prop_sparkle', 43],
  ] as const)('resolves prop hint %s at z-index %i', (propHint, id, zIndex) => {
    const clip = new AssetResolver(manifest).resolve(createSystemAnimationIntent('walk', 'neutral', { propHint }));
    expect(clip.props?.[0]).toMatchObject({ id, zIndex });
  });

  it('falls back to body_idle when the preferred body asset is unavailable', () => {
    const fallbackManifest: NormalizedSpriteManifest = { schemaVersion: 1, animations: { body_idle: manifest.animations.body_idle! } };
    const clip = new AssetResolver(fallbackManifest).resolve(createSystemAnimationIntent('walk'));

    expect(clip.body.animationKey).toBe('body_idle');
  });
});
