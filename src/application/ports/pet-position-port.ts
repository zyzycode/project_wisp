import type { ScreenBoundsDto, Vector2Dto } from '../../domain/behavior/motion-engine';

export interface PetPositionPort {
  commitRootPosition(input: {
    readonly rootPosition: Vector2Dto;
    readonly bounds: ScreenBoundsDto;
  }): void;
}
