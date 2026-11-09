import { expect, it } from 'vitest';
import { scenario } from './autonomy-scenario-fixture';

it('keeps a newly admitted cursor run in monotonic time when the source clock advances between reads', () => {
  const f = scenario({}, .999, undefined,
    { getCursorScreenPosition: () => ({ x: 440, y: 790 }) }, {}, false, .1);
  try {
    // Each read advances, as performance.now() does during a real Main frame.
    for (let i = 0; i < 5; i++) f.advance(100);
    f.setRandom(0); f.advance(100);
    const activity = f.main.getActivityTimeline();
    expect(activity?.activityId).toBe('cursor_interest');
    expect(activity!.phaseStartedAtMs).toBeGreaterThanOrEqual(activity!.startedAtMs);
    expect(f.main.getCursorGamePresentation()?.outcome).toBeNull();
  } finally { f.main.dispose(); }
});
