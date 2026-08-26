import { describe, it, expect } from 'vitest';
import { PetPositionService } from '../../src/application/services/pet-position.service';
import type { RectBounds } from '../../src/domain/models/position';

describe('Application: PetPositionService', () => {
  const screenBounds: RectBounds = {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  };

  it('initializes with default position (300, 300) when none provided', () => {
    const service = new PetPositionService();
    expect(service.getPosition()).toEqual({ x: 300, y: 300 });
  });

  it('initializes with provided custom position', () => {
    const service = new PetPositionService({ x: 500, y: 400 });
    expect(service.getPosition()).toEqual({ x: 500, y: 400 });
  });

  it('returns a new object copy from getPosition to prevent mutation', () => {
    const service = new PetPositionService({ x: 100, y: 100 });
    const pos = service.getPosition();
    pos.x = 999;
    expect(service.getPosition()).toEqual({ x: 100, y: 100 });
  });

  it('manages pet dimensions via getPetSize and setPetSize', () => {
    const service = new PetPositionService();
    expect(service.getPetSize()).toEqual({ width: 100, height: 100 });

    service.setPetSize({ width: 120, height: 140 });
    expect(service.getPetSize()).toEqual({ width: 120, height: 140 });
  });

  it('updates and clamps position within screen bounds', () => {
    const service = new PetPositionService({ x: 200, y: 200 });

    // Valid inside bounds
    const updated = service.updatePosition({ x: 400, y: 400 }, screenBounds);
    expect(updated).toEqual({ x: 400, y: 400 });
    expect(service.getPosition()).toEqual({ x: 400, y: 400 });

    // Out of bounds - should be clamped to maxX = 1920 - 100 = 1820, maxY = 1080 - 100 = 980
    const clamped = service.updatePosition({ x: 2500, y: 2000 }, screenBounds);
    expect(clamped).toEqual({ x: 1820, y: 980 });
    expect(service.getPosition()).toEqual({ x: 1820, y: 980 });
  });
});
