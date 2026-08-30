import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ManifestLoader } from '../../src/renderer/render-engine/manifest-loader';
import { DEFAULT_SPRITE_PIVOT } from '../../src/renderer/render-engine/types';

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
    expect(manifest.schemaVersion).toBe(1);
    expect(walk?.fps).toBe(8);
    expect(idle?.fps).toBe(8);
    expect(idle?.frames.map((frame) => Math.round(frame.durationMs))).toEqual([125, 125, 125, 125]);
    expect(walk?.pivot).toEqual(DEFAULT_SPRITE_PIVOT);
    expect(walk?.frames.map((frame) => Math.round(frame.durationMs))).toEqual([125, 125, 125, 125]);
    expect(idle?.frameMeta?.map((meta) => meta.anchors?.face?.y ?? 180)).toEqual([180, 176, 174, 181]);
    expect(petting?.category).toBe('body/petting');
    expect(petting?.layer).toBe('body');
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
    expect(idle?.fps).toBe(8);
    expect(idle?.framesCount).toBe(1);
    expect(idle?.frames[0]?.durationMs).toBe(125);
    expect(idle?.frames[0]?.pivot).toEqual(DEFAULT_SPRITE_PIVOT);
  });
});
