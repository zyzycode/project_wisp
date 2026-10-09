import { expect, it } from 'vitest';
import { BrainActivityRuntime } from '../../src/application/services/brain-activity-runtime';

function fixture(repeatedRawId = false) {
  let now = 0, rawId = 0, seed = 7, completed = 0, started = 0;
  const bounds = { id: 'screen', x: 0, y: 0, width: 1000, height: 800 };
  const snapshot = { needs: { energy: 40, attention: 20, play: 20, comfort: 20, boredom: 30 }, synthesizedTone: 'neutral' as const };
  const runtime = new BrainActivityRuntime({ clock: { now: () => now }, getCharacterSnapshot: () => snapshot,
    getSelectionContext: () => ({ character: snapshot, synthesizedTone: 'neutral', environment: { capturedAtMs: now,
      screenBounds: bounds, currentSurface: { id: 'floor', kind: 'screen_floor', bounds, isValidSupport: true } } }),
    getRootPosition: () => ({ x: 500, y: 790 }), getCollisionInsets: () => ({ left: 50, right: 50, top: 90, bottom: 10 }),
    nextRandom: () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; },
    requestLocomotion: () => true, cancelLocomotion: () => true,
    createRunId: () => repeatedRawId ? 'repeat' : `run-${++rawId}`, onVisualIntent: () => {},
    onStarted: () => { started++; }, onTerminated: result => { if (result.status === 'completed') completed++; } });
  return { runtime, now: () => now, advance: (value: number) => { now = value; runtime.tick(now); },
    counts: () => ({ started, completed }) };
}

it('runs eight deterministic model hours without growing per-run identity storage', () => {
  const f = fixture();
  let runs = 0, previousId = '', minPause = Infinity, maxPause = 0;
  while (f.now() < 8 * 60 * 60 * 1000) {
    expect(f.runtime.start({ kind: 'idle', source: 'timer', priority: 'normal' })).toBe(true);
    const active = f.runtime.getRuntime()!;
    expect(active.runId).not.toBe(previousId);
    previousId = active.runId;
    const pause = active.phaseEndsAtMs! - f.now();
    minPause = Math.min(minPause, pause); maxPause = Math.max(maxPause, pause);
    f.advance(active.phaseEndsAtMs!);
    expect(f.runtime.getRuntime()).toBeNull();
    runs++;
  }
  expect(runs).toBeGreaterThan(3000);
  expect(f.counts()).toEqual({ started: runs, completed: runs });
  expect(minPause).toBeGreaterThanOrEqual(6500);
  expect(maxPause).toBeLessThan(10000);
  expect(maxPause - minPause).toBeGreaterThan(3000);
  const retained = Object.values(f.runtime).filter(value => value instanceof Map || value instanceof Set)
    .reduce((sum, value) => sum + value.size, 0);
  expect(retained).toBeLessThanOrEqual(64);
});

it('rejects the previous run completion when the injected raw name repeats', () => {
  const f = fixture(true);
  const wander = { kind: 'wander', source: 'timer', priority: 'normal' } as const;
  expect(f.runtime.start(wander)).toBe(true);
  const previous = f.runtime.getRuntime()!;
  f.runtime.cancel('user_interaction');
  expect(f.runtime.start(wander)).toBe(true);
  const current = f.runtime.getRuntime()!;
  expect(current.runId).not.toBe(previous.runId);
  expect(f.runtime.notifyLocomotionCompleted({ runId: previous.runId, stepId: previous.currentStepId })).toBe(false);
  expect(f.runtime.getRuntime()).toEqual(current);
  expect(f.runtime.notifyLocomotionCompleted({ runId: current.runId, stepId: current.currentStepId })).toBe(true);
});
