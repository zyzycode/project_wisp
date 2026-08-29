import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPRITE_PIVOT,
  ManifestLoader,
  ManifestValidationError,
  getFrameAnchor,
} from '../../src/renderer/render-engine';

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

  it('correctly resolves frame-specific anchors with fallback to defaultAnchors', () => {
    const manifest = loader.load({
      schemaVersion: 1,
      animations: {
        body_idle: {
          category: 'body/idle',
          frames: ['idle_0.png', 'idle_1.png', 'idle_2.png'],
          defaultAnchors: {
            face: { x: 256, y: 126 },
            head: { x: 256, y: 100 },
          },
          frameMeta: [
            {},
            {
              anchors: {
                face: { x: 256, y: 124 },
              },
            },
            {
              anchors: {
                face: { x: 256, y: 122 },
                leftHand: { x: 180, y: 250 },
              },
            },
          ],
        },
      },
    });

    const idle = manifest.animations.body_idle;
    expect(idle).toBeDefined();

    // Frame 0: empty frameMeta -> falls back to defaultAnchors.face
    expect(getFrameAnchor(idle, 0, 'face')).toEqual({ x: 256, y: 126 });
    expect(idle?.frames[0]?.anchors?.face).toEqual({ x: 256, y: 126 });

    // Frame 1: frame-specific override -> { x: 256, y: 124 }
    expect(getFrameAnchor(idle, 1, 'face')).toEqual({ x: 256, y: 124 });
    expect(idle?.frames[1]?.anchors?.face).toEqual({ x: 256, y: 124 });

    // Frame 2: frame-specific override -> { x: 256, y: 122 }
    expect(getFrameAnchor(idle, 2, 'face')).toEqual({ x: 256, y: 122 });
    expect(getFrameAnchor(idle, 2, 'leftHand')).toEqual({ x: 180, y: 250 });
    // Head anchor falls back to defaultAnchors.head
    expect(getFrameAnchor(idle, 2, 'head')).toEqual({ x: 256, y: 100 });
  });

  it('returns null when anchor is absent on both frame and default', () => {
    const manifest = loader.load({
      schemaVersion: 1,
      animations: {
        body_walk: {
          category: 'body/walk',
          frames: ['walk_0.png', 'walk_1.png'],
          defaultAnchors: {
            head: { x: 256, y: 100 },
          },
          frameMeta: [
            {},
            { anchors: { leftHand: { x: 180, y: 250 } } },
          ],
        },
      },
    });

    const walk = manifest.animations.body_walk;
    expect(getFrameAnchor(walk, 0, 'face')).toBeNull();
    expect(getFrameAnchor(walk, 1, 'face')).toBeNull();
    expect(getFrameAnchor(walk, 0, 'rightHand')).toBeNull();
  });

  it('works transparently with legacy manifest without defaultAnchors or frameMeta', () => {
    const manifest = loader.load({
      schemaVersion: 1,
      animations: {
        body_scared: {
          category: 'body/scared',
          frames: ['scared_0.png', 'scared_1.png'],
        },
      },
    });

    const scared = manifest.animations.body_scared;
    expect(scared?.defaultAnchors).toBeUndefined();
    expect(scared?.frameMeta).toBeUndefined();
    expect(getFrameAnchor(scared, 0, 'face')).toBeNull();
    expect(getFrameAnchor(scared, 1, 'face')).toBeNull();
    expect(scared?.frames[0]?.anchors).toBeUndefined();
  });

  it.each([
    ['empty frames', { body_walk: { category: 'body/walk', frames: [] } }],
    ['framesCount mismatch', { body_walk: { category: 'body/walk', framesCount: 2, frames: ['walk.png'] } }],
    ['non-positive fps', { body_walk: { category: 'body/walk', fps: 0, frames: ['walk.png'] } }],
    ['path traversal in frame source', { body_walk: { category: 'body/walk', frames: ['../walk.png'] } }],
    ['negative custom frame duration', { body_walk: { category: 'body/walk', frames: [{ source: 'walk.png', durationMs: -1 }] } }],
    ['non-array frameMeta', { body_walk: { category: 'body/walk', frames: ['walk.png'], frameMeta: 'invalid' } }],
    ['malformed anchor coordinates', { body_walk: { category: 'body/walk', frames: ['walk.png'], defaultAnchors: { face: { x: 'bad', y: 10 } } } }],
  ])('rejects invalid manifests: %s', (_, invalidManifest) => {
    expect(() => loader.load(invalidManifest)).toThrow(ManifestValidationError);
  });
});
