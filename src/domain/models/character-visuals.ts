/**
 * Domain Model: Character Visuals & Expressions
 * Pure domain definitions for rendering states, palettes, and scaling.
 */

export type CharacterExpression =
  | 'idle'
  | 'happy'
  | 'curious'
  | 'sleepy'
  | 'surprised'
  | 'flying';

export interface CharacterColorPalette {
  primary: string;
  secondary: string;
  accent: string;
  glow: string;
  eyes: string;
}

export interface CharacterTheme {
  id: string;
  name: string;
  palette: CharacterColorPalette;
}

export const DEFAULT_THEMES: Record<string, CharacterTheme> = {
  cosmic: {
    id: 'cosmic',
    name: 'Космический',
    palette: {
      primary: '#a855f7',
      secondary: '#6366f1',
      accent: '#38bdf8',
      glow: 'rgba(168, 85, 247, 0.65)',
      eyes: '#ffffff',
    },
  },
  emerald: {
    id: 'emerald',
    name: 'Изумрудный',
    palette: {
      primary: '#10b981',
      secondary: '#06b6d4',
      accent: '#a7f3d0',
      glow: 'rgba(16, 185, 129, 0.65)',
      eyes: '#ffffff',
    },
  },
  amber: {
    id: 'amber',
    name: 'Янтарный',
    palette: {
      primary: '#f59e0b',
      secondary: '#ef4444',
      accent: '#fde68a',
      glow: 'rgba(245, 158, 11, 0.65)',
      eyes: '#ffffff',
    },
  },
};

/**
 * Validates and clamps character scale between safe minimum and maximum multipliers.
 */
export function clampCharacterScale(scale: number, min = 0.5, max = 2.5): number {
  if (Number.isNaN(scale) || !Number.isFinite(scale)) {
    return 1.0;
  }
  return Math.max(min, Math.min(max, Math.round(scale * 100) / 100));
}

/**
 * Calculates rendered dimensions in pixels based on base size and scale factor.
 */
export function calculateRenderedDimensions(
  baseSize: { width: number; height: number },
  scale: number
): { width: number; height: number } {
  const safeScale = clampCharacterScale(scale);
  return {
    width: Math.round(baseSize.width * safeScale),
    height: Math.round(baseSize.height * safeScale),
  };
}
