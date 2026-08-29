import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SPRITE_PIVOT, ManifestLoader, ManifestValidationError } from '../../src/renderer/render-engine';

const loader = new ManifestLoader();

describe('Renderer: ManifestLoader', () => {
  it('normalizes the legacy flat manifest with default fps, pivot, and frame timing', () => {
    const rawManifest: unknown = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/assets/sprites/manifest.json'), 'utf8')
    );
    const manifest = loader.load(rawManifest);

    const walk = manifest.animations.body_walk;
    const idle = manifest.animations.body_idle;
    const petting = manifest.animations.body_petting;
    expect(manifest.schemaVersion).toBe(1);
    expect(walk?.fps).toBe(3);
    expect(idle?.fps).toBe(3);
    expect(idle?.frames.map((frame) => Math.round(frame.durationMs))).toEqual([333, 333, 333, 333, 333, 333, 333, 333]);
    expect(walk?.pivot).toEqual(DEFAULT_SPRITE_PIVOT);
    expect(walk?.frames.map((frame) => Math.round(frame.durationMs))).toEqual([333, 333, 333, 333]);
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
          pivot: { x: 100, y: 200 },
          frames: [
            { source: 'walk_0.png', durationMs: 120 },
            { source: 'walk_1.png', durationMs: 140 },
          ],
        },
      },
    });

    expect(manifest.animations.body_walk?.fps).toBe(10);
    expect(manifest.animations.body_walk?.frames[0]?.durationMs).toBe(120);
    expect(manifest.animations.body_walk?.frames[1]?.durationMs).toBe(140);
  });

  it.each([
    ['empty frames', { body_walk: { category: 'body/walk', frames: [] } }],
    ['framesCount mismatch', { body_walk: { category: 'body/walk', framesCount: 2, frames: ['walk.png'] } }],
    ['non-positive fps', { body_walk: { category: 'body/walk', fps: 0, frames: ['walk.png'] } }],
    ['path traversal in frame source', { body_walk: { category: 'body/walk', frames: ['../walk.png'] } }],
    ['negative custom frame duration', { body_walk: { category: 'body/walk', frames: [{ source: 'walk.png', durationMs: -1 }] } }],
  ])('rejects invalid manifests: %s', (_, invalidManifest) => {
    expect(() => loader.load(invalidManifest)).toThrow(ManifestValidationError);
  });
});
