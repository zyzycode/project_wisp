import { expect, it, vi } from 'vitest';
import { OwnGoalsRuntime } from '../../src/application/services/own-goals-runtime';
import type { IMotivationRepository, MotivationRecord, OwnPlanStep } from '../../src/application/ports/motivation.interface';
import type { MemoryResult } from '../../src/application/ports/memory-repository.interface';
import { settleOwnGoals } from '../../src/domain/character/own-goals';
import { restoreOwnPlan } from '../../src/domain/character/own-plans';

const initial = Date.parse('2026-11-05T10:00:00.000Z');
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
function fixture(saved: MotivationRecord | null = null) {
  let state = saved, now = initial, generation = 0, allowed = true, count = 0, busy = false, needs = { energy: 35, boredom: 70 };
  const repository: IMotivationRepository = {
    read: vi.fn<IMotivationRepository['read']>(async time => ({ ok: true, value: state = state ? settleOwnGoals(state, time) : null })),
    restore: vi.fn<NonNullable<IMotivationRepository['restore']>>(async time => ({ ok: true, value: state = state ? restoreOwnPlan(state, time) : null })),
    replace: vi.fn<IMotivationRepository['replace']>(async (value, expected) => {
      if ((state?.revision ?? null) !== expected) return { ok: false, code: 'conflict' };
      state = value; return { ok: true, value: undefined };
    }),
  };
  const finished = vi.fn();
  const runtime = new OwnGoalsRuntime({ repository, context: () => ({ generation }), wallNow: () => now,
    getNeeds: () => needs, eligible: () => allowed && !busy, createId: kind => `${kind}-${++count}`,
    planning: { appRunId: () => 'app', onOpportunityFinished: finished } });
  const start = (step: OwnPlanStep, run = `run-${count}`) => runtime.offerPlanStep(step, () => {
    busy = true; runtime.activityStarted(run, step === 'rest' ? 'rest' : step === 'explore' ? 'explore' : 'calm'); return true;
  });
  return { runtime, repository, finished, start, get state() { return state; }, setNow: (ms: number) => { now = initial + ms; },
    setAllowed: (value: boolean) => { allowed = value; }, setNeeds: (value: typeof needs) => { needs = value; },
    terminal: (run: string, outcome: 'completed' | 'cancelled' | 'failed' = 'completed') => { busy = false; runtime.activityOutcome(run, outcome); },
    reset: () => { generation++; runtime.invalidate(); state = null; } };
}
it('runs rest, Explore and exact calm in order only after each acknowledged matching claim and actual terminal', async () => {
  const f = fixture(); f.runtime.opportunity(); await flush();
  for (const [step, run] of [['rest', 'rest-1'], ['explore', 'explore-2'], ['calm_look_around', 'calm-3']] as const) {
    expect(f.runtime.selectedPlanStep()).toBe(step);
    f.runtime.opportunity(); expect(f.start(step, run)).toBe(true); await flush();
    expect(f.state?.plan?.claim).not.toBeNull();
    f.runtime.activityOutcome('preview-or-duplicate', 'completed'); await flush();
    f.terminal(run); f.runtime.activityOutcome(run, 'completed'); await flush();
    if (step === 'explore') { f.setNeeds({ energy: 70, boredom: 20 }); f.runtime.opportunity(); await flush(); }
  }
  expect(f.state?.plan).toBeNull(); expect(f.state?.goals.map(g => g.status)).toEqual(['completed', 'completed']);
  expect(f.finished).not.toHaveBeenCalled();
});
it('never dispatches a claim after unrelated start, user interruption or changed gates while acknowledgement is pending', async () => {
  for (const mode of ['other-start', 'contact', 'quiet'] as const) {
    const f = fixture(); f.runtime.opportunity(); await flush();
    let ack: ((result: MemoryResult<void>) => void) | undefined;
    const replace = f.repository.replace;
    vi.mocked(f.repository.replace).mockImplementationOnce(async (value, expected, context) => {
      const result = await replace(value, expected, context); return new Promise(resolve => { ack = () => resolve(result); });
    });
    const start = vi.fn(() => true);
    expect(f.runtime.offerPlanStep('rest', start)).toBe(true); await flush();
    if (mode === 'other-start') f.runtime.activityStarted('reactive', 'cursor_interest');
    if (mode === 'contact') f.runtime.interruptPlanAdmission();
    if (mode === 'quiet') f.setAllowed(false);
    ack?.({ ok: true, value: undefined }); await flush();
    expect(start).not.toHaveBeenCalled(); expect(f.state?.plan).toBeNull();
    expect(f.state?.goals.find(g => g.kind === 'seek_novelty')?.status).toBe('abandoned');
    expect(f.finished).toHaveBeenCalledOnce();
  }
});
it('keeps lost claim acknowledgements and crash claims from replay; restores only an unclaimed fresh template', async () => {
  const f = fixture(); f.runtime.opportunity(); await flush();
  const replace = f.repository.replace;
  vi.mocked(f.repository.replace).mockImplementationOnce(async (value, expected, context) => {
    await replace(value, expected, context); return { ok: false, code: 'unavailable' };
  });
  const start = vi.fn(() => true); f.runtime.offerPlanStep('rest', start); await flush();
  expect(start).not.toHaveBeenCalled(); expect(f.state?.plan?.claim).not.toBeNull();
  const restarted = fixture(f.state); await restarted.runtime.restore();
  expect(restarted.state?.plan).toBeNull(); expect(restarted.state?.goals.find(g => g.kind === 'seek_novelty')?.status).toBe('abandoned');
  const normal = fixture(); normal.runtime.opportunity(); await flush(); normal.start('rest', 'r'); await flush(); normal.terminal('r'); await flush();
  const resumed = fixture(normal.state); resumed.setNeeds({ energy: 70, boredom: 70 }); await resumed.runtime.restore();
  expect(resumed.runtime.selectedPlanStep()).toBeNull(); resumed.runtime.opportunity(); await flush();
  expect(resumed.state?.plan).toMatchObject({ attempts: 1, stepIndex: 0, steps: ['explore', 'calm_look_around'] });
});
it('treats a committed run that rejects its first visual as one failed step, not a second not-started attempt', async () => {
  const f = fixture(); f.runtime.opportunity(); await flush();
  f.runtime.offerPlanStep('rest', () => { f.runtime.activityStarted('r', 'rest'); f.runtime.activityOutcome('r', 'failed'); return false; }); await flush();
  expect(f.state?.plan).toBeNull(); expect(f.state?.goals.find(g => g.kind === 'seek_novelty')?.status).toBe('cancelled');
  expect(f.finished).not.toHaveBeenCalled();
});
it('admits an unchanged unclaimed startup template only after a fresh opportunity, even in the same clock millisecond', async () => {
  const f = fixture(); f.runtime.opportunity(); await flush();
  const restarted = fixture(f.state); await restarted.runtime.restore();
  expect(restarted.runtime.selectedPlanStep()).toBeNull();
  restarted.runtime.opportunity(); await flush();
  expect(restarted.runtime.selectedPlanStep()).toBe('rest');
});
