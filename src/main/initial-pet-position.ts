import type { ScreenBounds } from '../application/ports/platform-adapter.interface';
import { PET_PRESENTATION_LAYOUT, calculateWindowRootPivotOffset } from '../shared/pet-presentation-layout';
import { clampRootPosition, DEFAULT_MOTION_CONSTRAINTS } from '../domain/behavior/motion-engine';
import { rootToNativePosition } from '../infrastructure/adapters/electron-pet-position-adapter';

export function initialPetWindowPosition(workArea: ScreenBounds): { readonly x: number; readonly y: number } {
  const pivot = calculateWindowRootPivotOffset(PET_PRESENTATION_LAYOUT);
  const bounds = { id: 'initial-screen', ...workArea };
  const root = clampRootPosition({
    x: workArea.x + Math.max(20, workArea.width - PET_PRESENTATION_LAYOUT.compactWindowSize.width - 60) + pivot.x,
    y: workArea.y + workArea.height - DEFAULT_MOTION_CONSTRAINTS.collisionInsets.bottom,
  }, bounds, DEFAULT_MOTION_CONSTRAINTS.collisionInsets);
  return rootToNativePosition(root, bounds, pivot);
}
