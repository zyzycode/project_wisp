import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AssetResolver, ManifestLoader, type NormalizedSpriteAnimationDef, type NormalizedSpriteManifest } from '../../src/renderer/render-engine';
import { createSystemAnimationIntent } from '../../src/domain/animation/animation-intent';

const manifest: NormalizedSpriteManifest = {
  schemaVersion: 1,
  animations: {
    body_idle: animation('body_idle', 'body/idle', 'body'),
    body_idle_flustered: animation('body_idle_flustered', 'body/idle', 'body'),
    body_walk: animation('body_walk', 'body/walk', 'body'),
    body_walk_playful: animation('body_walk_playful', 'body/walk', 'body'),
    face_happy: animation('face_happy', 'face/happy', 'face'),
    face_angry: animation('face_angry', 'face/angry', 'face'),
    face_sad: animation('face_sad', 'face/sad', 'face'),
    face_shocked: animation('face_shocked', 'face/shocked', 'face'),
    face_sleep: animation('face_sleep', 'face/sleep', 'face'),
    face_talking: animation('face_talking', 'face/talking', 'face'),
    face_thinking: animation('face_thinking', 'face/thinking', 'face'),
    face_curious: animation('face_curious', 'face/curious', 'face'),
    face_pout: animation('face_pout', 'face/pout', 'face'),
    face_winking: animation('face_winking', 'face/winking', 'face'),
    face_dizzy: animation('face_dizzy', 'face/dizzy', 'face'),
    face_flirty: animation('face_flirty', 'face/flirty', 'face'),
    expression_wink: animation('expression_wink', 'expression/wink', 'expression'),
    prop_pillow: animation('prop_pillow', 'props/pillow', 'props'),
    prop_heart: animation('prop_heart', 'props/heart', 'props'),
    prop_question: animation('prop_question', 'props/question', 'props'),
    prop_sparkle: animation('prop_sparkle', 'props/sparkle', 'props'),
  },
};

function animation(
  key: string,
  category: NormalizedSpriteAnimationDef['category'],
  layer: 'body' | 'face' | 'expression' | 'props'
): NormalizedSpriteAnimationDef {
  return {
    key,
    category,
    layer,
    frames: [
      { source: `${key}_0.png`, durationMs: 100, pivot: { x: 256, y: 460 } },
      { source: `${key}_1.png`, durationMs: 100, pivot: { x: 256, y: 460 } },
      { source: `${key}_2.png`, durationMs: 100, pivot: { x: 256, y: 460 } },
      { source: `${key}_3.png`, durationMs: 100, pivot: { x: 256, y: 460 } },
    ],
    framesCount: 4,
    fps: 10,
    pivot: { x: 256, y: 460 },
    tags: [],
    ...(layer === 'body' ? {
      faceOverlay: {
        mode: 'overlay' as const,
        allowedFaceKeys: ['face_happy', 'face_angry', 'face_sad', 'face_shocked', 'face_sleep', 'face_talking', 'face_thinking', 'face_curious', 'face_pout', 'face_winking', 'face_dizzy', 'face_flirty', 'face_gaze'],
        fallback: 'face_happy',
        anchor: 'face',
      },
    } : {}),
  };
}

describe('Renderer: AssetResolver', () => {
  it.each([
    ['idle_blink', 'body_idle'],
    ['settle', 'body_idle'],
    ['walk', 'body_walk'],
    ['run', 'body_run'],
    ['fall', 'body_fall'],
    ['land', 'body_land'],
    ['crash_landing', 'body_crash_splat'],
    ['sit', 'body_sit'],
    ['stand_up', 'body_stand_up'],
    ['get_up', 'body_stand_up'],
    ['lie_down', 'body_lie'],
    ['sleep_start', 'body_sleep_trans'],
    ['sleep_loop', 'body_sleep'],
    ['climb_wall', 'body_climb_wall'],
    ['hang_ceiling', 'body_ceiling_hang'],
    ['jump', 'body_jump'],
    ['dragged', 'body_dragged'],
    ['wave', 'body_wave'],
    ['celebrate', 'body_celebrate'],
    ['spook', 'body_scared'],
    ['bored', 'body_bored'],
    ['thinking_loop', 'body_thinking'],
  ] as const)('maps %s to the manifest body key %s', (kind, expectedBodyKey) => {
    const rawManifest: unknown = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/assets/sprites/manifest.json'), 'utf8')
    );
    const clip = new AssetResolver(new ManifestLoader().load(rawManifest)).resolve(
      createSystemAnimationIntent(kind)
    );
    expect(clip.body.animationKey).toBe(expectedBodyKey);
  });

  it('maps walk to the real body_walk track with the four frames and normative body z-index', () => {
    const clip = new AssetResolver(manifest).resolve(createSystemAnimationIntent('walk'));

    expect(clip.body.animationKey).toBe('body_walk');
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
    const wink = resolver.resolve(createSystemAnimationIntent('idle_blink', 'playful', { expressionHint: 'winking', propHint: 'none' }));

    expect(happy.face).toMatchObject({ id: 'face', category: 'face', zIndex: 20 });
    expect(wink.face).toMatchObject({ animationKey: 'face_winking', category: 'face', zIndex: 20 });
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
    ['curious', 'face_curious'],
    ['pout', 'face_pout'],
    ['winking', 'face_winking'],
    ['dizzy', 'face_dizzy'],
    ['flirty', 'face_flirty'],
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

  it('uses the specified static face_gaze frame only for overlay-compatible bodies', () => {
    const rawManifest: unknown = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/assets/sprites/manifest.json'), 'utf8')
    );
    const resolver = new AssetResolver(new ManifestLoader().load(rawManifest));
    const idle = resolver.resolve(createSystemAnimationIntent('idle_blink', 'neutral', {
      expressionHint: 'gaze', gazeDirection: 'up',
    }));
    const walk = resolver.resolve(createSystemAnimationIntent('walk', 'neutral', {
      expressionHint: 'gaze', gazeDirection: 'up',
    }));

    expect(idle.face).toMatchObject({
      animationKey: 'face_gaze', fixedFrameIndex: 2, anchorName: 'face', followBodyAnchor: false,
      offset: { x: 0, y: -334 },
    });
    expect(idle.face?.pivot).toEqual({ x: 256, y: 460 });
    expect(idle.face?.frames[2]?.pivot).toEqual({ x: 256, y: 460 });
    expect(walk.face).toBeUndefined();
  });

  it.each([
    ['pillow', 'prop_pillow', 40],
    ['heart', 'prop_heart', 41],
    ['question', 'prop_question', 42],
    ['sparkle', 'prop_sparkle', 43],
  ] as const)('resolves prop hint %s to %s at z-index %d', (propHint, expectedKey, expectedZIndex) => {
    const clip = new AssetResolver(manifest).resolve(
      createSystemAnimationIntent('idle_blink', 'neutral', { propHint })
    );

    expect(clip.props?.[0]?.animationKey).toBe(expectedKey);
    expect(clip.props?.[0]?.zIndex).toBe(expectedZIndex);
  });

  it('falls back to body_idle when the preferred body asset is unavailable', () => {
    const clip = new AssetResolver(manifest).resolve(createSystemAnimationIntent('spook'));

    expect(clip.body.animationKey).toBe('body_idle');
  });

  it('uses the exact tone-specialized body and matching overlays at Level 1', () => {
    const levelOneManifest: NormalizedSpriteManifest = {
      schemaVersion: 1,
      animations: {
        body_walk_playful: animation('body_walk_playful', 'body/walk', 'body'),
        face_winking: animation('face_winking', 'face/happy', 'face'),
        prop_sparkle: animation('prop_sparkle', 'props/sparkle', 'props'),
      },
    };
    const clip = new AssetResolver(levelOneManifest).resolve(createSystemAnimationIntent('walk', 'playful'));

    expect(clip.body.animationKey).toBe('body_walk_playful');
    expect(clip.face?.animationKey).toBe('face_winking');
    expect(clip.props?.[0]?.animationKey).toBe('prop_sparkle');
  });

  it('uses the base body while preserving available blush and prop hints at Level 2', () => {
    const levelTwoManifest: NormalizedSpriteManifest = {
      schemaVersion: 1,
      animations: {
        body_walk: animation('body_walk', 'body/walk', 'body'),
        prop_sparkle: animation('prop_sparkle', 'props/sparkle', 'props'),
      },
    };
    const clip = new AssetResolver(levelTwoManifest).resolve(createSystemAnimationIntent('walk', 'playful'));

    expect(clip.body.animationKey).toBe('body_walk');
    expect(clip.face).toBeUndefined();
    expect(clip.props?.[0]?.animationKey).toBe('prop_sparkle');
  });

  it('returns the static system baseline at Level 3 when no body assets exist', () => {
    const clip = new AssetResolver({ schemaVersion: 1, animations: {} }).resolve(
      createSystemAnimationIntent('walk', 'playful')
    );

    expect(clip.body.frames[0]?.source).toBe('system://wisp/default_idle.svg');
    expect(clip.body.animationKey).toBe('system_default_idle');
  });

  it('hides the full face track for baked_in body poses', () => {
    const bakedManifest: NormalizedSpriteManifest = {
      schemaVersion: 1,
      animations: {
        body_sleep: {
          ...animation('body_sleep', 'body/idle', 'body'),
          faceOverlay: { mode: 'baked_in', fallback: 'none' },
        },
        face_happy: animation('face_happy', 'face/happy', 'face'),
      },
    };
    const clip = new AssetResolver(bakedManifest).resolve(
      createSystemAnimationIntent('sleep_loop', 'neutral', { expressionHint: 'happy' })
    );

    expect(clip.face).toBeUndefined();
  });

  it('hides the full face track for none body poses', () => {
    const noneManifest: NormalizedSpriteManifest = {
      schemaVersion: 1,
      animations: {
        body_dance: {
          ...animation('body_dance', 'body/walk', 'body'),
          faceOverlay: { mode: 'none', fallback: 'none' },
        },
        face_happy: animation('face_happy', 'face/happy', 'face'),
      },
    };
    const clip = new AssetResolver(noneManifest).resolve(
      createSystemAnimationIntent('walk', 'neutral', { expressionHint: 'happy' })
    );

    expect(clip.face).toBeUndefined();
  });

  it('uses only an allowed face key and falls back safely when the requested face is disallowed', () => {
    const clip = new AssetResolver(manifest).resolve(
      createSystemAnimationIntent('idle_blink', 'neutral', { expressionHint: 'disallowed_custom' as any })
    );

    expect(clip.face?.animationKey).toBe('face_happy');
  });

  it('resolves exact manifest body and face keys for the debug inspector', () => {
    const clip = new AssetResolver(manifest).resolveDebugSelection('body_walk', 'face_happy');

    expect(clip.body.animationKey).toBe('body_walk');
    expect(clip.face?.animationKey).toBe('face_happy');
  });

  it('provides sorted layer animation keys for debugging and tooling surfaces', () => {
    const resolver = new AssetResolver(manifest);

    expect(resolver.getAnimationKeys('body')).toEqual(['body_idle', 'body_idle_flustered', 'body_walk', 'body_walk_playful']);
    expect(resolver.getAnimationKeys('face')).toEqual([
      'face_angry',
      'face_curious',
      'face_dizzy',
      'face_flirty',
      'face_happy',
      'face_pout',
      'face_sad',
      'face_shocked',
      'face_sleep',
      'face_talking',
      'face_thinking',
      'face_winking',
    ]);
  });
});
