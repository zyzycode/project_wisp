import { expect, it } from 'vitest';
import { createHabitState, emptyHabitMemory, startHabitRun, finishHabitRun, recordHabitPose, interruptHabit, habitMultiplier } from '../../src/domain/character/own-habit';
import { selectLocalActivity } from '../../src/domain/behavior/local-activity-policy';
const wall = (at: number) => new Date(Date.parse('2026-11-05T10:00:00.000Z') + at).toISOString();
function fixture() {
  let state = createHabitState(0), memory = emptyHabitMemory(), sequence = 0, time = 300000;
  const start = (kind: string, id = `${++sequence}:run`) => { state = startHabitRun(state, 'app', id, kind, sequence, time); return id; };
  const terminal = (id: string, success = true) => { const next = finishHabitRun(memory, state, 'app', id, success, time, wall(time)); memory = next.memory; state = next.state; };
  const explore = () => { const id = start('explore'); time += 1000; terminal(id); return id; };
  const transition = (positive = true) => { explore(); time += 1000; const id = start('calm'); state = recordHabitPose(state, id, positive ? 'look_around' : 'idle_blink'); time += 1000; terminal(id); time += 300000; };
  return { start, terminal, explore, transition, interrupt: () => { state = interruptHabit(state); },
    elapse: (ms: number) => { time += ms; }, get state() { return state; }, get memory() { return memory; }, get time() { return time; },
    factor: () => habitMultiplier(memory, state, time) };
}
it('learns exactly one factual transition per real Explore and needs six samples plus a fresh cue', () => {
  const f = fixture(); for (let i = 0; i < 5; i++) f.transition();
  f.explore(); expect(f.factor()).toBe(1); const next = f.start('calm');
  f.terminal(next); expect(f.memory.transitions).toHaveLength(6); f.terminal(next); expect(f.memory.transitions).toHaveLength(6);
  expect(f.factor()).toBe(1); f.elapse(300000); f.explore();
  expect(f.factor()).toBeCloseTo(1 + .1 * 5 / 6);
  f.elapse(60000); expect(f.factor()).toBeCloseTo(1 + .1 * 5 / 6);
  f.elapse(1); expect(f.factor()).toBe(1);
});
it('keeps the newest twenty distinct transitions, retaining other outcomes as evidence', () => {
  const f = fixture(); for (let i = 0; i < 25; i++) f.transition(i % 2 === 0);
  expect(f.memory.transitions).toHaveLength(20);
  expect(f.memory.transitions[0]?.exploreRunId).toBe('11:run');
  f.explore(); expect(f.factor()).toBeCloseTo(1.05);
});
it.each(['cancelled', 'interrupted', 'second-start', 'expired'] as const)('does not teach from %s and never reopens a consumed cue', mode => {
  const f = fixture(); f.explore();
  if (mode === 'expired') f.elapse(60001);
  const next = f.start('calm');
  if (mode === 'interrupted') f.interrupt();
  if (mode === 'second-start') f.start('play');
  f.terminal(next, mode !== 'cancelled'); expect(f.memory.transitions).toHaveLength(0);
  f.terminal(next); expect(f.memory.transitions).toHaveLength(0);
});
it('applies the five-minute learning gate from startup/reset while preview reads remain pure', () => {
  let state = createHabitState(0); const memory = emptyHabitMemory();
  state = startHabitRun(state, 'app', '1:e', 'explore', 1, 0);
  state = finishHabitRun(memory, state, 'app', '1:e', true, 1000, wall(1000)).state;
  const before = structuredClone(state); habitMultiplier(memory, state, 1000); expect(state).toEqual(before);
  state = startHabitRun(state, 'app', '2:c', 'calm', 2, 1000);
  expect(finishHabitRun(memory, state, 'app', '2:c', true, 2000, wall(2000)).memory).toEqual(memory);
});
it('distinguishes paired factual histories under identical Needs and tastes only while the Explore cue is fresh', () => {
  const familiar = fixture(), other = fixture();
  for (let i = 0; i < 6; i++) { familiar.transition(true); other.transition(false); }
  expect(familiar.factor()).toBe(other.factor()); familiar.explore(); other.explore();
  const snapshot = { needs: { energy: 70, attention: 0, play: 0, comfort: 60, boredom: 20 }, synthesizedTone: 'neutral' as const };
  const context = { nowMs: familiar.time, canExplore: true, canPlay: true, canRest: true, history: [] };
  let differs = false;
  for (let i = 0; i < 100; i++) {
    const a = selectLocalActivity(snapshot, { ...context, ownHabitMultiplier: familiar.factor() }, i / 100);
    const b = selectLocalActivity(snapshot, { ...context, ownHabitMultiplier: other.factor() }, i / 100);
    expect(a.intent.kind).toBe(b.intent.kind); differs ||= a.intent.calmPose !== b.intent.calmPose;
  }
  expect(differs).toBe(true); familiar.interrupt(); other.interrupt();
  expect(familiar.factor()).toBe(1); expect(other.factor()).toBe(1);
});
