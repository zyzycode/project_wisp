import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('loads public sprite manifest by URL rather than an unsupported Vite module import', () => {
  const source = readFileSync(resolve('src/renderer/components/Character/CharacterRenderer.tsx'), 'utf8');
  expect(/from\s+['"][^'"\n]*public\/assets\/sprites\/manifest\.json['"]/.test(source)).toBe(false);
  expect(source).toContain("fetch('./assets/sprites/manifest.json')");
});
