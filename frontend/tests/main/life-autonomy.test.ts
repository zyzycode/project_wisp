import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { metabolizeNeeds } from '../../src/domain/character/metabolism';
import { scenario } from './autonomy-scenario-fixture';

declare module 'vitest' {
  interface TaskMeta {
    life?: {
      readonly simulatedMs: number;
      readonly opportunities: number;
      readonly families: readonly string[];
      readonly peakTimers: number;
      readonly traceRows: number;
      readonly realElapsedMs: number;
      readonly providerRequests: number;
      readonly tickMs: Readonly<Record<'active' | 'stall', { readonly samples: number; readonly p50: number; readonly p95: number; readonly max: number }>>;
    };
  }
}

const DAY_MS = 86_400_000;

describe('LIFE-I01 autonomous lifetime', () => {
  it('keeps the fresh timer cancellable after an invalidated callback arrives late', () => {
    const f = scenario();
    try {
      const stale = [...f.timers.values()][0]!.callback;
      f.main.setMenuOpen(true);
      f.main.setMenuOpen(false);
      expect(f.timers.size).toBe(1);
      stale();
      f.main.setMenuOpen(true);
      expect(f.timers.size).toBe(0);
    } finally { f.main.dispose(); }
  });

  it('consumes an opportunity callback once and disposes its replacement', () => {
    const f = scenario();
    try {
      f.setMovable(false);
      const callback = [...f.timers.values()][0]!.callback;
      f.pulse();
      const trace = f.main.getDecisionTrace();
      callback();
      expect(f.main.getDecisionTrace()).toEqual(trace);
      expect(f.timers.size).toBe(1);
      f.main.dispose();
      expect(f.timers.size).toBe(0);
    } finally { f.main.dispose(); }
  });

  it('simulates seven days with bounded cadence, one-minute stall decay and final cleanup', ({ task }) => {
    const started = performance.now();
    const f = scenario();
    const families = new Set<string>();
    const activeTicks: number[] = [], stallTicks: number[] = [];
    const distribution = (samples: number[]) => {
      const sorted = [...samples].sort((a, b) => a - b);
      return { samples: sorted.length, p50: sorted[Math.floor(sorted.length * .5)]!,
        p95: sorted[Math.floor(sorted.length * .95)]!, max: sorted.at(-1)! };
    };
    let peakTimers = 0;
    let opportunities = 0;
    try {
      while (f.now() < 7 * DAY_MS) {
        f.setRandom([.95, .05, .25, .55][opportunities % 4]!);
        f.pulse();
        const activeAt = performance.now();
        f.main.tick();
        activeTicks.push(performance.now() - activeAt);
        const timeline = f.main.getActivityTimeline();
        if (timeline) families.add(timeline.activityId);
        f.finish();
        peakTimers = Math.max(peakTimers, f.timers.size);
        expect(f.timers.size).toBeLessThanOrEqual(1);
        expect(f.main.getDecisionTrace().length).toBeLessThanOrEqual(64);
        const outcomes = f.outcomes.length;
        f.main.notifyVoluntaryMovementCompleted({ runId: 'already-finished', stepId: 'stale' });
        expect(f.outcomes).toHaveLength(outcomes);
        // Test-owned observation buffers must not dominate the lifetime measurement.
        f.outcomes.length = 0;
        f.move.mockClear();
        f.main.setMenuOpen(true);
        const before = f.character.getState().needs;
        const currentTone = f.character.getSnapshot().synthesizedTone;
        const tone = f.main.isSleepingForRecovery() ? 'sleepy' : currentTone === 'sleepy' ? 'neutral' : currentTone;
        const stallAt = performance.now();
        f.advance(5 * 60_000);
        stallTicks.push(performance.now() - stallAt);
        const expected = metabolizeNeeds(before, 60_000, tone);
        const actual = f.character.getState().needs;
        for (const key of ['energy', 'attention', 'play', 'comfort', 'boredom'] as const) {
          expect(actual[key]).toBeCloseTo(expected[key]!, 8);
        }
        const once = f.character.getState();
        f.advance(0);
        expect(f.character.getState()).toEqual(once);
        f.main.setMenuOpen(false);
        opportunities++;
      }
      expect(families.size).toBeGreaterThan(1);
      expect(peakTimers).toBe(1);
      const stale = [...f.timers.values()].map(timer => timer.callback);
      f.main.dispose();
      const state = f.character.getState();
      stale.forEach(callback => callback());
      f.advance(30 * DAY_MS);
      f.main.resumeAfterUserInteraction();
      f.main.start();
      expect(f.timers.size).toBe(0);
      expect(f.character.getState()).toEqual(state);
      task.meta.life = { simulatedMs: f.now() - 30 * DAY_MS,
        opportunities, families: [...families], peakTimers, traceRows: f.main.getDecisionTrace().length,
        realElapsedMs: performance.now() - started, providerRequests: 0,
        tickMs: { active: distribution(activeTicks), stall: distribution(stallTicks) } };
    } finally { f.main.dispose(); }
  });
});
