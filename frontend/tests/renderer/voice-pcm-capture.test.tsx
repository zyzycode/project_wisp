import { expect, it } from 'vitest';
import { MonoPcmCollector } from '../../src/renderer/voice-pcm-capture';
it('downsamples continuously across blocks and bounds 30 seconds of mono PCM', () => {
  const pcm = new MonoPcmCollector(48_000, 3);
  expect(pcm.append(new Float32Array([0, 0.3]))).toBe(false);
  expect(pcm.append(new Float32Array([0.6, 1, 1, 1, -1, -1, -1, 1]))).toBe(true);
  const samples = pcm.take();
  expect(samples).toHaveLength(3); expect(samples[0]).toBeCloseTo(0.3);
  expect(samples.slice(1)).toEqual([1, -1]); expect(pcm.take()).toEqual([]);
});
it('drops nonfinite samples and clamps input to valid PCM', () => {
  const pcm = new MonoPcmCollector(16_000);
  pcm.append(new Float32Array([NaN, Infinity, 4, -4])); expect(pcm.take()).toEqual([0, 0, 1, -1]);
});
