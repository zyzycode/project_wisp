import { describe, expect, it } from 'vitest';
import { scenario } from './autonomy-scenario-fixture';

describe('global cursor isolation', () => {

  it('keeps autonomous decisions and scheduler cadence identical with far global refreshes', () => {
    const baseline = scenario();
    const observed = scenario({}, .2, undefined, { getCursorScreenPosition: () => ({ x: -1000, y: -1000 }) });
    for (let opportunity = 0; opportunity < 100; opportunity += 1) {
      for (let tick = 0; tick < 20; tick += 1) {
        baseline.advance(100); observed.advance(100);
      }
      expect(observed.main.getActivityTimeline()).toEqual(baseline.main.getActivityTimeline());
      expect([...observed.timers.values()].map(timer => timer.atMs))
        .toEqual([...baseline.timers.values()].map(timer => timer.atMs));
      expect(observed.pulse()).toBe(baseline.pulse());
      observed.finish(); baseline.finish();
      expect(observed.main.getDecisionTrace()).toEqual(baseline.main.getDecisionTrace());
      expect(observed.main.getVisualEpisode()).toEqual(baseline.main.getVisualEpisode());
    }
    baseline.main.dispose(); observed.main.dispose();
  });
});
