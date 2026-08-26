import { describe, it, expect } from 'vitest';
import {
  clampCharacterScale,
  calculateRenderedDimensions,
  DEFAULT_THEMES,
} from '../../src/domain/models/character-visuals';

describe('Domain: Character Visuals', () => {
  it('contains default cosmic, emerald, and amber themes', () => {
    expect(DEFAULT_THEMES.cosmic).toBeDefined();
    expect(DEFAULT_THEMES.emerald).toBeDefined();
    expect(DEFAULT_THEMES.amber).toBeDefined();
    expect(DEFAULT_THEMES.cosmic?.palette.glow).toBeDefined();
  });

  it('clamps scale within min and max boundaries', () => {
    expect(clampCharacterScale(0.2)).toBe(0.5);
    expect(clampCharacterScale(3.0)).toBe(2.5);
    expect(clampCharacterScale(1.25)).toBe(1.25);
    expect(clampCharacterScale(NaN)).toBe(1.0);
  });

  it('calculates rendered dimensions based on scale', () => {
    const base = { width: 100, height: 100 };
    expect(calculateRenderedDimensions(base, 1.0)).toEqual({ width: 100, height: 100 });
    expect(calculateRenderedDimensions(base, 1.5)).toEqual({ width: 150, height: 150 });
    expect(calculateRenderedDimensions(base, 0.5)).toEqual({ width: 50, height: 50 });
  });
});
