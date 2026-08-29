import { describe, expect, it } from 'vitest';
import { AssetResolver, type NormalizedSpriteManifest } from '../../src/renderer/render-engine';
import { createSystemAnimationIntent } from '../../src/domain/animation/animation-intent';

const manifest: NormalizedSpriteManifest = {
  schemaVersion: 1,
  animations: {
    body_walk: animation('body_walk', 'body/walk', 'body'),
    body_idle: animation('body_idle', 'body/idle', 'body'),
    face_happy: animation('face_happy', 'face/happy', 'face'),
    face_angry: animation('face_angry', 'face/angry', 'face'),
    face_sad: animation('face_sad', 'face/sad', 'face'),
    face_shocked: animation('face_shocked', 'face/shocked', 'face'),
    face_sleep: animation('face_sleep', 'face/sleep', 'face'),
    face_talking: animation('face_talking', 'face/talking', 'face'),
    face_thinking: animation('face_thinking', 'face/thinking', 'face'),
    expression_wink: animation('expression_wink', 'expression/wink', 'expression'),
    prop_pillow: animation('prop_pillow', 'props/pillow', 'props'),
    prop_heart: animation('prop_heart', 'props/heart', 'props'),
    prop_question: animation('prop_question', 'props/question', 'props'),
    prop_sparkle: animation('prop_sparkle', 'props/sparkle', 'props'),
  },
};

function animation(
  key: string,
  category:
    | 'body/walk'
    | 'body/idle'
    | 'face/happy'
    | 'face/angry'
    | 'face/sad'
    | 'face/shocked'
    | 'face/sleep'
    | 'face/talking'
    | 'face/thinking'
    | 'expression/wink'
    | 'props/pillow'
    | 'props/heart'
    | 'props/question'
    | 'props/sparkle',
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
    ...(layer === 'body' ? {
      faceOverlay: {
        mode: 'overlay' as const,
        allowedFaceKeys: ['face_happy', 'face_angry', 'face_sad', 'face_shocked', 'face_sleep', 'face_talking', 'face_thinking'],
        fallback: 'face_happy',
        anchor: 'face',
      },
    } : {}),
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
    ['happy', 'face_happy'],
    ['angry', 'face_angry'],
    ['sad', 'face_sad'],
    ['shocked', 'face_shocked'],
    ['sleepy', 'face_sleep'],
    ['talking', 'face_talking'],
    ['thinking', 'face_thinking'],
  ] as const)('resolves face expression hint %s to %s with looping mode and zIndex 20', (expressionHint, expectedKey) => {
    const clip = new AssetResolver(manifest).resolve(
      createSystemAnimationIntent('idle_blink', 'neutral', { expressionHint })
    );

    expect(clip.face).toMatchObject({
      id: 'face',
      category: 'face',
      animationKey: expectedKey,
      zIndex: 20,
      playbackMode: 'loop',
    });
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
    const idle = manifest.animations.body_idle;
    if (idle === undefined) throw new Error('Test manifest must contain body_idle.');
    const fallbackManifest: NormalizedSpriteManifest = { schemaVersion: 1, animations: { body_idle: idle } };
    const clip = new AssetResolver(fallbackManifest).resolve(createSystemAnimationIntent('walk'));

    expect(clip.body.animationKey).toBe('body_idle');
  });

  it('uses the exact tone-specialized body and matching overlays at Level 1', () => {
    const levelOneManifest: NormalizedSpriteManifest = {
      ...manifest,
      animations: { ...manifest.animations, body_walk_playful: animation('body_walk_playful', 'body/walk', 'body') },
    };
    const clip = new AssetResolver(levelOneManifest).resolve(createSystemAnimationIntent('walk', 'playful'));

    expect(clip.body.animationKey).toBe('body_walk_playful');
    expect(clip.expression?.animationKey).toBe('expression_wink');
    expect(clip.props?.[0]?.animationKey).toBe('prop_sparkle');
  });

  it('uses the base body while preserving available blush and prop hints at Level 2', () => {
    const clip = new AssetResolver(manifest).resolve(createSystemAnimationIntent('walk', 'flustered'));

    expect(clip.body.animationKey).toBe('body_walk');
    expect(clip.proceduralBlush).toBeDefined();
    expect(clip.props?.[0]?.animationKey).toBe('prop_heart');
  });

  it('returns the static system baseline at Level 3 when no body assets exist', () => {
    const clip = new AssetResolver({ schemaVersion: 1, animations: {} }).resolve(createSystemAnimationIntent('sleep_loop'));

    expect(clip.body.frames[0]?.source).toBe('system://wisp/default_idle.svg');
    expect(clip.body.animationKey).toBe('system_default_idle');
  });

  it.each(['baked_in', 'none'] as const)('hides the full face track for %s body poses', (mode) => {
    const bakedBody = manifest.animations.body_walk;
    if (bakedBody === undefined) throw new Error('Test manifest must contain body_walk.');
    const bakedManifest: NormalizedSpriteManifest = {
      schemaVersion: 1,
      animations: {
        ...manifest.animations,
        body_walk: { ...bakedBody, faceOverlay: { mode, fallback: 'none' } },
      },
    };

    const clip = new AssetResolver(bakedManifest).resolve(
      createSystemAnimationIntent('walk', 'neutral', { expressionHint: 'happy' })
    );

    expect(clip.face).toBeUndefined();
  });

  it('uses only an allowed face key and falls back safely when the requested face is disallowed', () => {
    const body = manifest.animations.body_walk;
    if (body === undefined) throw new Error('Test manifest must contain body_walk.');
    const compatibleManifest: NormalizedSpriteManifest = {
      schemaVersion: 1,
      animations: {
        ...manifest.animations,
        body_walk: {
          ...body,
          faceOverlay: {
            mode: 'overlay', allowedFaceKeys: ['face_sad'], fallback: 'face_sad', anchor: 'face',
          },
        },
      },
    };

    const clip = new AssetResolver(compatibleManifest).resolve(
      createSystemAnimationIntent('walk', 'neutral', { expressionHint: 'happy' })
    );

    expect(clip.face).toMatchObject({ animationKey: 'face_sad', anchorName: 'face' });
  });

  it('resolves exact manifest body and face keys for the debug inspector', () => {
    const body = manifest.animations.body_walk;
    if (body === undefined) throw new Error('Test manifest must contain body_walk.');
    const resolver = new AssetResolver({
      schemaVersion: 1,
      animations: {
        ...manifest.animations,
        body_walk: { ...body, faceOverlay: { mode: 'baked_in', fallback: 'none' } },
      },
    });

    const clip = resolver.resolveDebugSelection('body_walk', 'face_angry');

    expect(clip.body.animationKey).toBe('body_walk');
    expect(clip.face).toMatchObject({ animationKey: 'face_angry', zIndex: 20 });
    expect(clip.face?.anchorName).toBeUndefined();
    expect(resolver.getAnimationKeys('body')).toEqual(['body_idle', 'body_walk']);
    expect(resolver.getAnimationKeys('face')).toEqual([
      'face_angry',
      'face_happy',
      'face_sad',
      'face_shocked',
      'face_sleep',
      'face_talking',
      'face_thinking',
    ]);
  });
});
