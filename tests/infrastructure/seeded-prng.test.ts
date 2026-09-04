import { describe, expect, it } from 'vitest';
import { SeededPrng } from '../../src/infrastructure/random/seeded-prng';

describe('Infrastructure: SeededPrng', () => {
  it('repeats the same bounded sequence for the same explicit seed', () => {
    const first = new SeededPrng(12345);
    const second = new SeededPrng(12345);
    const sequence = () => Array.from({ length: 8 }, () => first.next());

    const firstSequence = sequence();
    const secondSequence = Array.from({ length: 8 }, () => second.next());
    expect(firstSequence).toEqual(secondSequence);
    expect(firstSequence.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('rejects seeds outside uint32', () => {
    expect(() => new SeededPrng(-1)).toThrow(RangeError);
    expect(() => new SeededPrng(0x1_0000_0000)).toThrow(RangeError);
  });
});
