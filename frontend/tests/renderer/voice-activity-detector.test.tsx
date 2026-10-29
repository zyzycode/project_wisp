import { expect, it } from 'vitest';
import { VoiceActivityDetector } from '../../src/renderer/voice-activity-detector';

const frame = (amplitude: number) => new Float32Array(320).fill(amplitude);
function feed(detector: VoiceActivityDetector, count: number, amplitude: number): readonly number[][] {
  const results: number[][] = [];
  for (let i = 0; i < count; i++) results.push(...detector.append(frame(amplitude)));
  return results;
}
it('ignores silence and short clicks, emits a phrase after 800ms silence with preroll', () => {
  const detector = new VoiceActivityDetector();
  expect(feed(detector, 100, 0)).toEqual([]);
  expect(feed(detector, 3, 0.1)).toEqual([]);
  expect(feed(detector, 40, 0)).toEqual([]);
  feed(detector, 20, 0);
  expect(feed(detector, 20, 0.1)).toEqual([]);
  expect(feed(detector, 39, 0)).toEqual([]);
  const result = feed(detector, 1, 0);
  expect(result).toHaveLength(1);
  expect(result[0]?.length).toBe(74 * 320);
  expect(result[0]?.slice(0, 14 * 320).every(value => value === 0)).toBe(true);
  expect(feed(detector, 100, 0)).toEqual([]);
});
it('bounds an unbroken phrase at 15 seconds and resets buffered audio explicitly', () => {
  const detector = new VoiceActivityDetector();
  const results = feed(detector, 750, 0.1);
  expect(results).toHaveLength(1);
  expect(results[0]).toHaveLength(240_000);
  feed(detector, 20, 0.1); detector.reset();
  expect(feed(detector, 50, 0)).toEqual([]);
});
it('keeps framing across arbitrary browser blocks and clears a partial frame on reset', () => {
  const detector = new VoiceActivityDetector();
  detector.append(new Float32Array(161).fill(0.1)); detector.reset();
  expect(detector.append(new Float32Array(319))).toEqual([]);
  expect(feed(detector, 50, 0)).toEqual([]);
});
it('does not accumulate isolated noise clicks into a speech utterance', () => {
  const detector = new VoiceActivityDetector();
  const results: number[][] = [];
  for (let i = 0; i < 14; i++) {
    results.push(...feed(detector, 1, 0.1));
    results.push(...feed(detector, 25, 0));
  }
  results.push(...feed(detector, 40, 0));
  expect(results).toHaveLength(0);
});
