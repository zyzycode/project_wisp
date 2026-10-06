import { describe, it, expect } from 'vitest';
import { PetPositionService } from '../../src/application/services/pet-position.service';

describe('Application: PetPositionService', () => {
  const bounds = { id: 'secondary', x: -1200, y: 40, width: 1000, height: 800 };
  const insets = { left: 35, right: 65, top: 80, bottom: 15 };

  it('stores the logical root and returns defensive copies', () => {
    const service = new PetPositionService({ x: -600, y: 400 });
    const root = service.getRootPosition() as { x: number; y: number };
    root.x = 999;
    expect(service.getRootPosition()).toEqual({ x: -600, y: 400 });
  });

  it('validates and clamps root coordinates with asymmetric collision insets', () => {
    const service = new PetPositionService();
    expect(service.updateRootPosition({ x: -2000, y: 2000 }, bounds, insets))
      .toEqual({ x: -1165, y: 825 });
    expect(service.getRootPosition()).toEqual({ x: -1165, y: 825 });
    expect(() => service.updateRootPosition(
      { x: Number.NaN, y: 0 },
      bounds,
      insets
    )).toThrow(RangeError);
  });
});
