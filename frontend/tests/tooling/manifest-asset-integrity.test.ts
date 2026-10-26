import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Tooling: Sprite & Manifest Asset Integrity', () => {
  it('scripts/validate_manifest.py exists and runs clean validation check', () => {
    const scriptPath = resolve(process.cwd(), 'scripts/validate_manifest.py');
    expect(existsSync(scriptPath)).toBe(true);

    const output = execFileSync(process.env.WISP_PYTHON ?? 'python', [scriptPath, '--check', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    const report = JSON.parse(output);
    expect(report.isValid).toBe(true);
    expect(report.errorsCount).toBe(0);
    expect(report.registeredAnimationsCount).toBeGreaterThan(0);
    expect(report.scannedFilesCount).toBeGreaterThan(0);
  });

});
