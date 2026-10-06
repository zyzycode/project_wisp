import { expect, it } from 'vitest';
import { initialPetWindowPosition } from '../../src/main/initial-pet-position';
import { nativeToRootPosition } from '../../src/infrastructure/adapters/electron-pet-position-adapter';
import { calculateWindowRootPivotOffset, PET_PRESENTATION_LAYOUT } from '../../src/shared/pet-presentation-layout';
import { DEFAULT_MOTION_CONSTRAINTS } from '../../src/domain/behavior/motion-engine';
import { cursorGameReachable } from '../../src/domain/behavior/cursor-game';

it.each([{ x: 0, y: 0, width: 1920, height: 1040 }, { x: -1280, y: -400, width: 1280, height: 984 }])(
  'starts grounded on the real floor so a nearby cursor is reachable: %j', workArea => {
    const pivot = calculateWindowRootPivotOffset(PET_PRESENTATION_LAYOUT);
    const root = nativeToRootPosition(initialPetWindowPosition(workArea), pivot);
    expect(Math.abs(root.y - (workArea.y + workArea.height - DEFAULT_MOTION_CONSTRAINTS.collisionInsets.bottom))).toBeLessThanOrEqual(.5);
    expect(cursorGameReachable({ root, cursor: { capturedAtMs: 0, globalPosition: { x: root.x - 40, y: root.y } },
      collisionInsets: DEFAULT_MOTION_CONSTRAINTS.collisionInsets, dwellMs: 500,
      environment: { capturedAtMs: 0, screenBounds: { id: 'screen', ...workArea },
        currentSurface: { id: 'floor', kind: 'screen_floor', bounds: workArea, isValidSupport: true } } }, 0)).toBe(true);
  });
