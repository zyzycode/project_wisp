import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SPRITE_FPS, DEFAULT_SPRITE_PIVOT, ManifestLoader, ManifestValidationError } from '../../src/renderer/render-engine';

const loader = new ManifestLoader();

describe('Renderer: ManifestLoader', () => {
  it('normalizes the legacy flat manifest with default fps, pivot, and frame timing', () => {
    const rawManifest: unknown = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/assets/sprites/manifest.json'), 'utf8')
    );
    const manifest = loader.load(rawManifest);

    const walk = manifest.animations.body_walk;
    const happy = manifest.animations.face_happy;
    expect(manifest.schemaVersion).toBe(1);
    expect(walk?.fps).toBe(DEFAULT_SPRITE_FPS);
    expect(walk?.pivot).toEqual(DEFAULT_SPRITE_PIVOT);
    expect(walk?.frames.map((frame) => frame.durationMs)).toEqual([125, 125, 125, 125]);
    expect(happy?.category).toBe('face/happy');
    expect(happy?.layer).toBe('face');
  });

  it('accepts canonical animations registry and preserves per-frame metadata', () => {
    const manifest = loader.parse({
      schemaVersion: 1,
      animations: {
        body_walk: {
          category: 'body/walk',
          fps: 10,
          pivot: { x: 100, y: 200 },
          sourceRect: { x: 0, y: 0, width: 32, height: 32 },
          frames: [{ source: '/assets/walk.png', durationMs: 80, pivot: { x: 2, y: 3 } }],
        },
      },
    });

    expect(manifest.animations.body_walk?.frames[0]).toEqual({
      source: '/assets/walk.png',
      durationMs: 80,
      pivot: { x: 2, y: 3 },
      sourceRect: { x: 0, y: 0, width: 32, height: 32 },
    });
  });

  it.each([
    [{ body_walk: { category: 'body/walk', frames: [] } }, 'at least one frame'],
    [{ body_walk: { category: 'body/walk', framesCount: 2, frames: ['walk.png'] } }, 'framesCount'],
    [{ body_walk: { category: 'body/walk', fps: 0, frames: ['walk.png'] } }, 'fps'],
    [{ body_walk: { category: 'body/walk', frames: ['../walk.png'] } }, 'without traversal'],
    [{ body_walk: { category: 'body/walk', frames: [{ source: 'walk.png', durationMs: -1 }] } }, 'durationMs'],
  ])('rejects invalid manifests: %s', (manifest, message) => {
    expect(() => loader.load(manifest)).toThrow(ManifestValidationError);
    expect(() => loader.load(manifest)).toThrow(message);
  });
});
