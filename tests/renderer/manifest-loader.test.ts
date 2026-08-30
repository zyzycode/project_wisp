import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ManifestLoader } from '../../src/renderer/render-engine/manifest-loader';
import { DEFAULT_FACE_FPS, DEFAULT_FACE_PIVOT, DEFAULT_SPRITE_FPS, DEFAULT_SPRITE_PIVOT } from '../../src/renderer/render-engine/types';

describe('Renderer: ManifestLoader', () => {
  const loader = new ManifestLoader();

  it('normalizes the legacy flat manifest with default fps, pivot, and frame timing', () => {
    const rawManifest: unknown = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/assets/sprites/manifest.json'), 'utf8')
    );
    const manifest = loader.load(rawManifest);

    const walk = manifest.animations.body_walk;
    const idle = manifest.animations.body_idle;
    const petting = manifest.animations.body_petting;
    const happyFace = manifest.animations.face_happy;
    expect(manifest.schemaVersion).toBe(1);
    expect(walk?.fps).toBe(DEFAULT_SPRITE_FPS);
    expect(idle?.fps).toBe(DEFAULT_SPRITE_FPS);
    expect(idle?.frames.map((frame) => Math.round(frame.durationMs))).toEqual([200, 200, 200, 200]);
    expect(walk?.pivot).toEqual(DEFAULT_SPRITE_PIVOT);
    expect(walk?.frames.map((frame) => Math.round(frame.durationMs))).toEqual([200, 200, 200, 200]);
    expect(idle?.frameMeta?.map((meta) => meta.anchors?.face?.y ?? 180)).toEqual([180, 176, 174, 181]);
    expect(petting?.category).toBe('body/petting');
    expect(petting?.layer).toBe('body');
    expect(happyFace?.fps).toBe(DEFAULT_FACE_FPS);
    expect(happyFace?.pivot).toEqual(DEFAULT_FACE_PIVOT);
    expect(happyFace?.frames.map((frame) => Math.round(frame.durationMs))).toEqual([333, 333, 333, 333]);
  });

  it('accepts canonical animations registry and preserves per-frame metadata', () => {
    const manifest = loader.parse({
      schemaVersion: 1,
      animations: {
        body_walk: {
          category: 'body/walk',
          fps: 10,
          frames: [
            { source: '/assets/sprites/body/walk/body_walk_00.png', durationMs: 100 },
            { source: '/assets/sprites/body/walk/body_walk_01.png', durationMs: 100 },
          ],
          defaultAnchors: { face: { x: 256, y: 120 } },
          frameMeta: [{ anchors: { face: { x: 256, y: 122 } } }],
        },
      },
    });

    const walk = manifest.animations.body_walk;
    expect(walk?.fps).toBe(10);
    expect(walk?.frames).toHaveLength(2);
    expect(walk?.defaultAnchors?.face).toEqual({ x: 256, y: 120 });
    expect(walk?.frameMeta?.[0]?.anchors?.face).toEqual({ x: 256, y: 122 });
  });

  it('tolerates missing optional metadata and fills baseline fallbacks safely', () => {
    const manifest = loader.parse({
      schemaVersion: 1,
      animations: {
        body_idle: {
          category: 'body/idle',
          frames: [{ source: 'idle.png' }],
        },
      },
    });

    const idle = manifest.animations.body_idle;
    expect(idle?.fps).toBe(DEFAULT_SPRITE_FPS);
    expect(idle?.framesCount).toBe(1);
    expect(idle?.frames[0]?.durationMs).toBe(200);
    expect(idle?.frames[0]?.pivot).toEqual(DEFAULT_SPRITE_PIVOT);
  });
});
