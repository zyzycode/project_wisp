import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { AssetResolver, ManifestLoader } from '../../src/renderer/render-engine';
import { createSystemAnimationIntent } from '../../src/domain/animation';

it('loads public sprite manifest by URL rather than an unsupported Vite module import', () => {
  const source = readFileSync(resolve('src/renderer/components/Character/CharacterRenderer.tsx'), 'utf8');
  expect(/from\s+['"][^'"\n]*public\/assets\/sprites\/manifest\.json['"]/.test(source)).toBe(false);
  expect(source).toContain("fetch('./assets/sprites/manifest.json')");
});

it('can render the existing technical fallback before the asynchronous manifest arrives', () => {
  const resolver = new AssetResolver(new ManifestLoader().load({}));
  const clip = resolver.resolve(createSystemAnimationIntent('idle_blink', 'neutral'));
  expect(clip.body.frames).toHaveLength(1);
  expect(clip.body.frames[0]?.source).toBe('system://wisp/default_idle.svg');
});
