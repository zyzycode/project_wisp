import { describe, it, expect } from 'vitest';
import {
  DEFAULT_THEMES,
} from '../../src/domain/models/character-visuals';

describe('Domain: Character Visuals', () => {
  it('contains default cosmic, emerald, and amber themes', () => {
    expect(DEFAULT_THEMES.cosmic).toBeDefined();
    expect(DEFAULT_THEMES.emerald).toBeDefined();
    expect(DEFAULT_THEMES.amber).toBeDefined();
    expect(DEFAULT_THEMES.cosmic?.palette.glow).toBeDefined();
  });

});
