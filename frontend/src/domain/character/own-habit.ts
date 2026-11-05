import { createAdaptationGate, takeAdaptationOpportunity, type AdaptationGate } from './adaptation-gate';
export type HabitTransition = {
  readonly appRunId: string; readonly exploreRunId: string; readonly nextRunId: string;
  readonly nextKind: 'calm_look_around' | 'other'; readonly completedAt: string;
}
export type HabitMemory = { readonly transitions: readonly HabitTransition[]; readonly lastLearnedAt: string | null };
interface Cue { readonly exploreRunId: string; readonly completedAtMs: number; }
interface Active { readonly runId: string; readonly activityId: string; readonly lookAround: boolean; readonly cue: Cue | null; }
export interface HabitState {
  readonly appRunId: string | null; readonly highWater: number; readonly gate: AdaptationGate;
  readonly cue: Cue | null; readonly active: Active | null; readonly lastMs: number;
}
export function emptyHabitMemory(): HabitMemory { return { transitions: [], lastLearnedAt: null }; }
export function createHabitState(nowMs: number): HabitState {
  return { appRunId: null, highWater: 0, gate: createAdaptationGate(nowMs), cue: null, active: null, lastMs: nowMs };
}
function validTime(s: HabitState, atMs: number): boolean { return Number.isFinite(atMs) && atMs >= 0 && atMs >= s.lastMs; }
export function interruptHabit(s: HabitState): HabitState { return { ...s, cue: null, active: s.active ? { ...s.active, cue: null } : null }; }
export function startHabitRun(s: HabitState, appRunId: string, runId: string, activityId: string, sequence: number, atMs: number): HabitState {
  if (!validTime(s, atMs) || !appRunId.trim() || !runId.trim() || !Number.isSafeInteger(sequence) || sequence < 1) return interruptHabit(s);
  if (s.appRunId !== null && s.appRunId !== appRunId) return s;
  if (sequence <= s.highWater) return s;
  const cue = s.cue && atMs - s.cue.completedAtMs <= 60000 ? s.cue : null;
  return { ...s, appRunId, highWater: sequence, cue: null, lastMs: atMs, active: { runId, activityId, lookAround: false, cue } };
}
export function recordHabitPose(s: HabitState, runId: string, pose: string): HabitState {
  return s.active?.runId === runId && s.active.activityId === 'calm'
    ? { ...s, active: { ...s.active, lookAround: pose === 'look_around' } } : s;
}
export function finishHabitRun(memory: HabitMemory, s: HabitState, appRunId: string, runId: string,
  completed: boolean, atMs: number, wall: string): { readonly memory: HabitMemory; readonly state: HabitState } {
  const active = s.active;
  if (!active || active.runId !== runId || s.appRunId !== appRunId) return { memory, state: s };
  let state: HabitState = { ...s, active: null, cue: null, ...(validTime(s, atMs) ? { lastMs: atMs } : {}) };
  if (!validTime(s, atMs) || !completed) return { memory, state };
  const cue = active.cue;
  if (cue && atMs - cue.completedAtMs <= 60000 && Number.isFinite(Date.parse(wall))
    && (memory.lastLearnedAt === null || wall >= memory.lastLearnedAt)
    && !memory.transitions.some(t => t.appRunId === appRunId && t.exploreRunId === cue.exploreRunId)) {
    const taken = takeAdaptationOpportunity(s.gate, atMs, true); state = { ...state, gate: taken.gate };
    if (taken.accepted) {
      const transition: HabitTransition = { appRunId, exploreRunId: cue.exploreRunId, nextRunId: runId,
        nextKind: active.activityId === 'calm' && active.lookAround ? 'calm_look_around' : 'other', completedAt: wall };
      memory = { transitions: [...memory.transitions, transition].slice(-20), lastLearnedAt: wall };
    }
  }
  if (active.activityId === 'explore') state = { ...state, cue: { exploreRunId: runId, completedAtMs: atMs } };
  return { memory, state };
}
export function habitMultiplier(memory: HabitMemory, s: HabitState, atMs: number): number {
  if (!validTime(s, atMs) || !s.cue || atMs - s.cue.completedAtMs > 60000 || memory.transitions.length < 6) return 1;
  return 1 + .1 * memory.transitions.filter(t => t.nextKind === 'calm_look_around').length / memory.transitions.length;
}
