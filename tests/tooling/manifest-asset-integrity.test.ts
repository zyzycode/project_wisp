import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Tooling: Sprite & Manifest Asset Integrity', () => {
  it('scripts/validate_manifest.py exists and runs clean validation check', () => {
    const scriptPath = resolve(process.cwd(), 'scripts/validate_manifest.py');
    expect(existsSync(scriptPath)).toBe(true);

    const output = execSync('python3 scripts/validate_manifest.py --check --json', {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    const report = JSON.parse(output);
    expect(report.isValid).toBe(true);
    expect(report.errorsCount).toBe(0);
    expect(report.registeredAnimationsCount).toBeGreaterThan(0);
    expect(report.scannedFilesCount).toBeGreaterThan(0);
  });

  it('verifies that every sprite listed in manifest.json actually exists in public directory', () => {
    const manifestPath = resolve(process.cwd(), 'public/assets/sprites/manifest.json');
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));

    const animations = raw.animations && typeof raw.animations === 'object' ? raw.animations : raw;

    for (const [key, animDef] of Object.entries(animations)) {
      if (typeof animDef !== 'object' || !animDef || key === 'schemaVersion') continue;
      const def = animDef as { frames: (string | { source: string })[] };
      expect(Array.isArray(def.frames)).toBe(true);
      expect(def.frames.length).toBeGreaterThan(0);

      for (const frame of def.frames) {
        const sourcePath = typeof frame === 'string' ? frame : frame.source;
        const cleanPath = sourcePath.replace(/^\//, '');
        const absPath = resolve(process.cwd(), 'public', cleanPath);
        expect(existsSync(absPath), `Sprite frame missing on disk: ${sourcePath} (key: ${key})`).toBe(true);
      }
    }
  });
});
