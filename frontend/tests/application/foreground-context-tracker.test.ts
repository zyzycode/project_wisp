import { expect, it } from 'vitest';
import { ForegroundContextTracker } from '../../src/application/services/foreground-context-tracker';
const sample = (at: number, revision = at + 1, appKey = 'opaque-app', episodeToken = 'episode') => ({ appKey, episodeToken, capturedAtMs: at, revision });
it('keeps cached timestamps and generations while stable history reaches the exact3s boundary', () => {
  const tracker = new ForegroundContextTracker();
  for (const at of [0, 1000, 2000]) tracker.observe(sample(at), at);
  const before = tracker.current(2999, 'active');
  expect(before.foreground).toBe('settling'); expect(before.sampledAtMs).toBe(2000);
  expect(tracker.current(3000, 'inactive')).toEqual({ ...before, presence: 'inactive', foreground: 'stable' });
  tracker.observe(sample(3000), 3000);
  expect(tracker.current(3000, 'active').generation).toBe(before.generation);
  expect(tracker.current(5500, 'active').foreground).toBe('stable');
  expect(tracker.current(5501, 'active')).toMatchObject({ foreground: 'unknown', sampledAtMs: 3000 });
});
it.each(['app', 'episode'] as const)('starts a new settling generation on opaque%s change', change => {
  const tracker = new ForegroundContextTracker(); tracker.observe(sample(0, 1), 0); tracker.observe(sample(1000, 2), 1000);
  const generation = tracker.current(1000, 'active').generation;
  tracker.observe(sample(2000, 3, change === 'app' ? 'next-app' : 'opaque-app', change === 'episode' ? 'next-episode' : 'episode'), 2000);
  expect(tracker.current(2000, 'active')).toMatchObject({ generation: generation + 1, foreground: 'settling' });
});
it.each(['duplicate', 'out-of-order', 'future', 'stale', 'gap', 'negative', 'nonfinite'] as const)('omits a%s stream and requires new valid history', reason => {
  const tracker = new ForegroundContextTracker(); tracker.observe(sample(0, 1), 0); tracker.observe(sample(1000, 2), 1000);
  const generation = tracker.current(1000, 'active').generation;
  if (reason === 'duplicate') tracker.observe(sample(1001, 2), 1001);
  if (reason === 'out-of-order') tracker.observe(sample(1001, 1), 1001);
  if (reason === 'future') tracker.observe(sample(1002, 3), 1001);
  if (reason === 'stale') tracker.observe(sample(0, 3), 2501);
  if (reason === 'gap') tracker.observe(sample(2501, 3), 2501);
  if (reason === 'negative') tracker.observe(sample(-1, 3), 1001);
  if (reason === 'nonfinite') tracker.observe(sample(NaN, 3), 1001);
  expect(tracker.current(3000, 'active')).toMatchObject({ foreground: 'unknown', generation: generation + 1 });
  tracker.observe(sample(3001, 4), 3001); expect(tracker.current(3001, 'active').foreground).toBe('settling');
});
it('accepts1500ms gaps, rejects clock rollback and never replays an old generation after reset', () => {
  const tracker = new ForegroundContextTracker(); tracker.observe(sample(0, 1), 0); tracker.observe(sample(1500, 2), 1500); tracker.observe(sample(3000, 3), 3000);
  expect(tracker.current(3000, 'active').foreground).toBe('stable');
  const generation = tracker.current(3000, 'active').generation;
  expect(tracker.current(2999, 'active')).toMatchObject({ foreground: 'unknown', generation: generation + 1 });
  tracker.reset(); tracker.observe(sample(3000, 1), 3000);
  expect(tracker.current(3000, 'unknown').foreground).toBe('settling');
});
it('retains only opaque source continuity even when the authorized envelope contains title metadata', () => {
  const tracker = new ForegroundContextTracker();
  const envelope = { ...sample(0), appName: 'Private editor', windowTitle: 'Private title', sourceToken: 'caption-token' };
  tracker.observe(envelope, 0);
  expect(JSON.stringify(tracker)).not.toMatch(/Private|windowTitle|appName|sourceToken|caption-token/u);
});
