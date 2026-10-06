import type { CollisionInsets, ScreenBoundsDto, Vector2Dto } from '../../domain/behavior/motion-engine';
import { clampRootPosition } from '../../domain/behavior/motion-engine';

export class PetPositionService {
  private currentRootPosition: Vector2Dto;

  constructor(initialRootPosition?: Vector2Dto) {
    this.currentRootPosition = initialRootPosition ?? { x: 300, y: 300 };
  }

  getRootPosition(): Vector2Dto {
    return { ...this.currentRootPosition };
  }

  updateRootPosition(
    target: Vector2Dto,
    bounds: ScreenBoundsDto,
    collisionInsets: CollisionInsets
  ): Vector2Dto {
    this.currentRootPosition = clampRootPosition(target, bounds, collisionInsets);
    return this.getRootPosition();
  }
}
