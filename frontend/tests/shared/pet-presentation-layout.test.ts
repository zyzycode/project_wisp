import { expect, it } from 'vitest';
import { PET_PRESENTATION_LAYOUT, calculateWindowRootPivotOffset } from '../../src/shared/pet-presentation-layout';

it('projects the canonical root into native DIP', () => {
  expect(calculateWindowRootPivotOffset(PET_PRESENTATION_LAYOUT)).toEqual({ x: 140, y: 233.625 });
});
it('keeps the same root when the menu expands', () => {
  expect(calculateWindowRootPivotOffset({ ...PET_PRESENTATION_LAYOUT, compactWindowSize: PET_PRESENTATION_LAYOUT.expandedWindowSize }))
    .toEqual(calculateWindowRootPivotOffset(PET_PRESENTATION_LAYOUT));
});
it('accounts for asymmetric letterboxing and an explicit character origin', () => {
  expect(calculateWindowRootPivotOffset({ ...PET_PRESENTATION_LAYOUT,
    characterRect: { x: 13, y: 27, width: 300, height: 200 }, spriteViewport: { width: 400, height: 100 }, spriteRootPivot: { x: 100, y: 80 },
  })).toEqual({ x: 88, y: 149.5 });
});
