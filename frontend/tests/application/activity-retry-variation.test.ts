import { describe, expect, it } from 'vitest';
import { BrainActivityRuntime } from '../../src/application/services/brain-activity-runtime';

function fixture() {
  let now = 0, run = 0, accepted = false, draws = 0;
  const bounds = { id: 'screen', x: 0, y: 0, width: 1000, height: 800 };
  const snapshot = { needs: { energy: 40, attention: 20, play: 20, comfort: 20, boredom: 30 }, synthesizedTone: 'neutral' as const };
  const targets: string[] = [];
  const runtime = new BrainActivityRuntime({ clock: { now: () => now }, getCharacterSnapshot: () => snapshot,
    getSelectionContext: () => ({ character: snapshot, synthesizedTone: 'neutral', environment: { capturedAtMs: now,
      screenBounds: bounds, currentSurface: { id: 'floor', kind: 'screen_floor', bounds, isValidSupport: true } } }),
    getRootPosition: () => ({ x: 500, y: 790 }), getCollisionInsets: () => ({ left: 50, right: 50, top: 90, bottom: 10 }),
    nextRandom: () => { draws++; return .3; }, requestLocomotion: r => { targets.push(r.targetRef); return accepted; },
    cancelLocomotion: () => true, createRunId: () => `run-${++run}`, onVisualIntent: () => {}, onTerminated: () => {} });
  return { runtime, targets, time: (value: number) => { now = value; }, accept: () => { accepted = true; }, draws: () => draws };
}
const wander = { kind: 'wander', source: 'timer', priority: 'normal' } as const;
describe('Activity retry and variation', () => {
  it('avoids a rejected route briefly without recording a successful visit or consuming preview RNG', () => {
    const f = fixture();
    expect(f.runtime.start(wander)).toBe(false);
    expect(f.runtime.canStart(wander)).toBe(true);
    expect(f.draws()).toBe(1);
    expect(f.runtime.start(wander)).toBe(false);
    expect(f.targets[1]).not.toBe(f.targets[0]);
    f.time(30000);
    expect(f.runtime.start(wander)).toBe(false);
    expect(f.targets[2]).toBe(f.targets[0]);
  });
  it('varies calm deadlines through seeded draws while preview remains pure', () => {
    const f = fixture();
    const idle = { kind: 'idle', source: 'timer', priority: 'normal' } as const;
    expect(f.runtime.canStart(idle)).toBe(true);
    expect(f.draws()).toBe(0);
    expect(f.runtime.start(idle)).toBe(true);
    expect(f.draws()).toBe(1);
    expect(f.runtime.getRuntime()?.phaseEndsAtMs).toBe(7550);
  });
});
