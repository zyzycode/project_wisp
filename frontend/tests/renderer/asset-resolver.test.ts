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
    face_winking: animation('face_winking', 'face/winking', 'face'),
    prop_heart: animation('prop_heart', 'props/heart', 'props'),
    prop_sparkle: animation('prop_sparkle', 'props/sparkle', 'props'),
  },
};

function animation(
  key: string,
  category: NormalizedSpriteAnimationDef['category'],
  layer: 'body' | 'face' | 'expression' | 'props'
): NormalizedSpriteAnimationDef {
  const pivot = layer === 'face' || layer === 'expression' ? { x: 256, y: 180 } : { x: 256, y: 460 };
  return {
    key,
    category,
    layer,
    frames: [
      { source: `${key}_0.png`, durationMs: 100, pivot },
      { source: `${key}_1.png`, durationMs: 100, pivot },
      { source: `${key}_2.png`, durationMs: 100, pivot },
      { source: `${key}_3.png`, durationMs: 100, pivot },
    ],
    framesCount: 4,
    fps: 10,
    pivot,
    tags: [],
    ...(layer === 'body' ? {
      faceOverlay: {
        mode: 'overlay' as const,
        allowedFaceKeys: ['face_happy', 'face_winking', 'face_gaze'],
        fallback: 'face_happy',
        anchor: 'face',
      },
    } : {}),
  };
}

describe('Renderer: AssetResolver', () => {
  it('uses a matched continuous pupil pair only for a compatible neutral face', () => {
    const rig = { ...manifest, animations: { ...manifest.animations,
      face_gaze_base: animation('face_gaze_base', 'face/gaze', 'face'),
      pupils_gaze: animation('pupils_gaze', 'face/pupils', 'face') } };
    const resolver = new AssetResolver(rig, { enableContinuousGaze: true });
    const result = resolver.resolve(createSystemAnimationIntent('idle_blink'));
    expect(result.face?.animationKey).toBe('face_gaze_base');
    expect(result.pupils?.animationKey).toBe('pupils_gaze');
    expect(resolver.resolve(createSystemAnimationIntent('happy_reaction', 'playful', { expressionHint: 'happy' })).pupils).toBeUndefined();
    const incomplete = new AssetResolver({ ...rig, animations: { ...manifest.animations,
      face_gaze_base: rig.animations.face_gaze_base } }, { enableContinuousGaze: true });
    expect(incomplete.resolve(createSystemAnimationIntent('idle_blink')).pupils).toBeUndefined();
  });
  it('uses the existing sit asset and pivot for missing sit_edge artwork', () => {
    const loaded = new ManifestLoader().load(JSON.parse(readFileSync(resolve(process.cwd(), 'public/assets/sprites/manifest.json'), 'utf8')));
    const withoutSitEdge = { ...loaded, animations: Object.fromEntries(
      Object.entries(loaded.animations).filter(([key]) => key !== 'body_sit_edge')
    ) };
    const result = new AssetResolver(withoutSitEdge).resolve(createSystemAnimationIntent('sit_edge'));
    expect(result.body.animationKey).toBe('body_sit');
    expect(result.rootPivot).toEqual(loaded.animations.body_sit!.pivot);
  });

  it('selects registered sit_edge artwork with its baked-in face', () => {
    const loaded = new ManifestLoader().load(JSON.parse(readFileSync(resolve(process.cwd(), 'public/assets/sprites/manifest.json'), 'utf8')));
    const result = new AssetResolver(loaded).resolve(createSystemAnimationIntent('sit_edge'));
    expect(result.body.animationKey).toBe('body_sit_edge');
    expect(result.body.frames).toHaveLength(4);
    expect(loaded.animations.body_sit_edge!.faceOverlay?.mode).toBe('baked_in');
  });

  it('holds existing grab/jump frames without moving pivots and keeps climb/ceiling/land clips intact', () => {
    const rawManifest: unknown = JSON.parse(readFileSync(resolve(process.cwd(), 'public/assets/sprites/manifest.json'), 'utf8'));
    const loaded = new ManifestLoader().load(rawManifest);
    const resolver = new AssetResolver(loaded);
    const grab = resolver.resolve(createSystemAnimationIntent('climb_wall', 'neutral', { loop: 'none' }));
    const jump = resolver.resolve(createSystemAnimationIntent('jump'));
    expect(grab.body.frames).toEqual([loaded.animations.body_climb_wall!.frames[0]]);
    expect(jump.body.frames).toEqual([loaded.animations.body_jump!.frames[0]]);
    expect(grab.rootPivot).toEqual(loaded.animations.body_climb_wall!.pivot);
    expect(jump.rootPivot).toEqual(loaded.animations.body_jump!.pivot);
    for (const kind of ['climb_wall', 'hang_ceiling', 'land'] as const) {
      expect(resolver.resolve(createSystemAnimationIntent(kind)).body.frames).toHaveLength(4);
    }
  });

  it('does not synthesize blush from persistent mood during neutral idle', () => {
    const clip = new AssetResolver(manifest).resolve(createSystemAnimationIntent('idle_blink', 'shy'));
    expect(clip.proceduralBlush).toBeUndefined();
  });

  it('resolves face, expression, procedural blush, and prop tracks with normative z-indexes', () => {
    const resolver = new AssetResolver(manifest);
    const happy = resolver.resolve(createSystemAnimationIntent('happy_reaction', 'neutral', { expressionHint: 'happy' }));
    const blushHeart = resolver.resolve(createSystemAnimationIntent('idle_blink', 'flustered', { expressionHint: 'blush', propHint: 'heart' }));
    const sparkle = resolver.resolve(createSystemAnimationIntent('walk', 'playful'));
    const wink = resolver.resolve(createSystemAnimationIntent('idle_blink', 'playful', { expressionHint: 'winking', propHint: 'none' }));

    expect(happy.face).toMatchObject({ id: 'face', category: 'face', zIndex: 20 });
    expect(wink.face).toMatchObject({ animationKey: 'face_winking', category: 'face', zIndex: 20 });
    expect(blushHeart.proceduralBlush?.id).toBe('procedural_blush');
    expect(blushHeart.props?.[0]).toMatchObject({ id: 'prop_heart', zIndex: 41, blendMode: 'additive' });
    expect(sparkle.props?.[0]).toMatchObject({ id: 'prop_sparkle', zIndex: 43, playbackMode: 'loop' });
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
      animationKey: 'face_gaze', fixedFrameIndex: 2, anchorName: 'face',
    });
    expect(idle.face?.pivot).toEqual({ x: 256, y: 180 });
    expect(idle.face?.frames[2]?.pivot).toEqual({ x: 256, y: 180 });
    expect(walk.face).toBeUndefined();
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

});
