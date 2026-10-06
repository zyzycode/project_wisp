import type { IPrng } from '../../domain/behavior/autonomous-behavior';

/** Small deterministic xorshift32 adapter with an explicit, non-wall-clock seed. */
export class SeededPrng implements IPrng {
  private state: number;

  public constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
      throw new RangeError('Seed must be an unsigned 32-bit integer');
    }
    this.state = seed === 0 ? 0x6d2b79f5 : seed >>> 0;
  }

  public next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x1_0000_0000;
  }
}
