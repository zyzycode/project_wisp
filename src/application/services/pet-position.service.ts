import {
  Point2D,
  Size2D,
  RectBounds,
  clampPositionToBounds,
} from '../../domain/models/position';

export class PetPositionService {
  private currentPosition: Point2D;
  private petSize: Size2D = { width: 100, height: 100 };

  constructor(initialPosition?: Point2D) {
    this.currentPosition = initialPosition ?? { x: 300, y: 300 };
  }

  getPosition(): Point2D {
    return { ...this.currentPosition };
  }

  getPetSize(): Size2D {
    return { ...this.petSize };
  }

  setPetSize(size: Size2D): void {
    this.petSize = { ...size };
  }

  updatePosition(target: Point2D, bounds: RectBounds): Point2D {
    const clamped = clampPositionToBounds(target, this.petSize, bounds);
    this.currentPosition = clamped;
    return this.currentPosition;
  }
}
