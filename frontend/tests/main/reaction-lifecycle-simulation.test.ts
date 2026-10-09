import { describe, expect, it } from 'vitest';
import { scenario } from './autonomy-scenario-fixture';

describe('deterministic reaction endurance', () => {
  it('recovers after an hour of inputs, menu/autonomy toggles, drag and restart', () => {
    const f = scenario({}, .2, undefined, { getCursorScreenPosition: () => ({ x: -1000, y: -1000 }) });
    const episodes = new Set<string>();
    const advance = (durationMs: number) => {
      for (let elapsed = 0; elapsed < durationMs; elapsed += 100) f.advance(100);
    };
    for (let cycle = 0; cycle < 120; cycle += 1) {
      f.main.setEnabled(cycle % 2 === 0);
      f.main.setMenuOpen(cycle % 3 === 0);
      f.main.handleCharacterInteraction(cycle % 2 === 0 ? 'click' : 'feed');
      const initial = f.main.getVisualEpisode();
      expect(episodes.has(initial.id)).toBe(false);
      episodes.add(initial.id);
      advance(1000);
      f.main.handleClick();
      advance(2000);
      expect(f.main.getVisualEpisode().intent.kind).toBe('happy_reaction');
      f.main.handleMotionEvent({ type: 'drag_started', atMs: f.now() });
      advance(1000);
      expect(f.main.getVisualEpisode().intent.kind).toBe('dragged');
      f.main.handleMotionEvent({ type: 'airborne_started', cause: 'throw_release', atMs: f.now() });
      advance(1000);
      expect(f.main.getVisualEpisode().intent.kind).toBe('fall');
      f.main.handleMotionEvent({ type: 'landed', outcome: cycle % 2 ? 'crash_landing' : 'soft_landing', impactSeverity: 10 });
      advance(2000);
      expect(f.main.getVisualEpisode().intent.kind).toBe('settle');
      f.main.resetCursorGame();
      f.main.stop();
      expect(f.main.getGlobalCursorSample()).toBeNull();
      f.main.start();
      f.main.setEnabled(false);
      f.main.setMenuOpen(false);
      f.main.handleCharacterInteraction('double_click');
      advance(3000);
      expect(f.main.getVisualEpisode().intent.kind).toBe('idle_blink');
      advance(20000);
      expect(f.main.getActivityTimeline()).toBeNull();
      expect(f.main.getVisualEpisode().intent.kind).toBe('idle_blink');
      expect(f.timers.size).toBe(0);
    }
    expect(f.now()).toBe(3_600_000);
    f.main.dispose();
  });

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
