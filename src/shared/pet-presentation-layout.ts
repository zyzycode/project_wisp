import type { PetPresentationLayoutDTO } from './ipc-contracts';

export const PET_PRESENTATION_LAYOUT: PetPresentationLayoutDTO = Object.freeze({
  compactWindowSize: Object.freeze({ width: 280, height: 320 }),
  expandedWindowSize: Object.freeze({ width: 1140, height: 620 }),
  characterRect: Object.freeze({ x: 20, y: 18, width: 240, height: 240 }),
  spriteViewport: Object.freeze({ width: 512, height: 512 }),
  spriteRootPivot: Object.freeze({ x: 256, y: 460 }),
});

/** Projects source-canvas coordinates into window DIP using SVG xMidYMid meet. */
export function calculateWindowRootPivotOffset(layout: PetPresentationLayoutDTO): { readonly x: number; readonly y: number } {
  const rect = layout.characterRect;
  const viewport = layout.spriteViewport;
  const scale = Math.min(rect.width / viewport.width, rect.height / viewport.height);
  return {
    x: rect.x + (rect.width - viewport.width * scale) / 2 + layout.spriteRootPivot.x * scale,
    y: rect.y + (rect.height - viewport.height * scale) / 2 + layout.spriteRootPivot.y * scale,
  };
}
