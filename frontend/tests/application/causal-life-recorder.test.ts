import { expect, it, vi } from 'vitest';
import { CausalLifeRecorder } from '../../src/application/services/causal-life-recorder';
import type { CausalLifeEpisode, ICausalLifeRepository } from '../../src/application/ports/causal-life.interface';
import type { ActivityOutcomeFeedback } from '../../src/application/ports/shimeji-feedback-port';

const event: ActivityOutcomeFeedback = { type: 'activity_outcome', eventId: 'run:terminal', activityRunId: 'run', activitySequence: 1, activity: 'cursor_game', terminalReason: 'user_interaction', atMs: 2000, family: 'cursor_interest', outcome: 'cancelled', participation: 'user_engaged', executedMs: 1500, playCompleted: false };
function fixture() {
  let generation = 0, persistent = true, appRunId = 'app';
  const observed: CausalLifeEpisode[] = [], append = vi.fn<ICausalLifeRepository['append']>().mockResolvedValue({ ok: true, value: undefined });
  const onFailure = vi.fn();
  const recorder = new CausalLifeRecorder({ repository: { append, getRecent: vi.fn(), resolveSources: vi.fn() }, appRunId: () => appRunId, context: () => persistent ? { generation } : null, generation: () => generation, toTimestamp: at => new Date(at).toISOString(), onObserved: e => observed.push(e), onFailure });
  return { recorder, observed, append, onFailure, reset: () => { generation++; appRunId = 'next'; recorder.reset(); }, offline: () => { persistent = false; }, mutation: () => { generation++; } };
}
it('records accepted contact independently of wake and binds only synchronous trusted input before cancellation', () => {
  const f = fixture();
  f.recorder.beginInput(true, 100); f.recorder.endInput();
  expect(f.observed[0]).toMatchObject({ cause: 'contact', sequence: 1, activity: null });
  f.recorder.beginInput(false, 2000); f.recorder.outcome(event); f.recorder.endInput();
  expect(f.observed[1]).toMatchObject({ cause: 'user_interrupted', source: 'user', sequence: 3, triggerSequence: 2, terminalReason: 'user_interaction' });
  f.recorder.outcome(event); expect(f.observed).toHaveLength(2);
  f.recorder.outcome({ ...event, activityRunId: 'unbound', activitySequence: 2 });
  expect(f.observed[2]).toMatchObject({ cause: 'unknown', source: 'unknown', triggerSequence: null });
});
it('separates known unrelated cancellation/environment from unknown and excludes other activities', () => {
  const f = fixture();
  f.recorder.outcome({ ...event, activity: undefined }); expect(f.observed).toHaveLength(0);
  let sequence = 1;
  for (const [id, reason, cause] of [['quiet', 'explicit_cancel', 'other'], ['loss', 'environment_invalidated', 'environment_lost'], ['time', 'step_timeout', 'timeout']] as const) {
    f.recorder.outcome({ ...event, activityRunId: id, activitySequence: ++sequence, terminalReason: reason });
    expect(f.observed.at(-1)).toMatchObject({ cause, source: 'system', triggerSequence: null });
  }
});
it('observes offline without storage and drops old generation binding and late failures after reset', async () => {
  const f = fixture(); let settle: ((value: { readonly ok: false; readonly code: 'io_error' }) => void) | undefined;
  f.append.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  f.recorder.beginInput(true, 100); f.reset();
  settle!({ ok: false, code: 'io_error' }); await Promise.resolve();
  expect(f.onFailure).not.toHaveBeenCalled();
  f.recorder.outcome(event); expect(f.observed.at(-1)).toMatchObject({ appRunId: 'next', sequence: 1, cause: 'unknown' });
  f.recorder.beginInput(false, 3000); f.mutation(); f.recorder.outcome({ ...event, activityRunId: 'late-generation', activitySequence: 2 });
  expect(f.observed.at(-1)?.cause).toBe('unknown');
  f.offline(); f.recorder.beginInput(true, 4000); f.recorder.endInput();
  expect(f.observed.at(-1)?.cause).toBe('contact'); expect(f.append).toHaveBeenCalledTimes(3);
});

it('persists contact before dispatch but observes only a non-interrupting contact at ingress completion', () => {
  const f = fixture();
  f.recorder.beginInput(true, 100);
  expect(f.append).toHaveBeenCalledTimes(1); expect(f.observed).toEqual([]);
  f.recorder.endInput(); expect(f.observed).toHaveLength(1);
  f.recorder.beginInput(true, 2000); f.recorder.outcome({ ...event, executedMs: 100 }); f.recorder.endInput();
  expect(f.observed.map(e => e.cause)).toEqual(['contact', 'user_interrupted']);
  f.recorder.beginInput(true, 3000);
  f.recorder.outcome({ ...event, activitySequence: 2, activityRunId: 'other', terminalReason: 'explicit_cancel' });
  f.recorder.endInput(); expect(f.observed.map(e => e.cause)).toEqual(['contact', 'user_interrupted', 'other']);
  f.recorder.beginInput(true, 4000);
  f.recorder.outcome({ ...event, activitySequence: 3, activity: undefined });
  f.recorder.endInput(); expect(f.observed).toHaveLength(3);
  f.recorder.beginInput(true, 5000); f.reset(); f.recorder.endInput(); expect(f.observed).toHaveLength(3);
  f.recorder.beginInput(true, 6000); f.recorder.outcome(event); f.recorder.endInput();
  expect(f.observed.at(-1)?.cause).toBe('contact');
});

it('keeps a constant terminal watermark across hundreds of runs and reset without replay effects', () => {
  const f = fixture();
  for (let i = 1; i <= 200; i++) f.recorder.outcome({ ...event, activityRunId: `run-${i}`, activitySequence: i });
  expect(f.observed).toHaveLength(200);
  f.recorder.outcome(event); expect(f.observed).toHaveLength(200);
  f.reset(); f.recorder.outcome(event); expect(f.observed).toHaveLength(200);
  f.recorder.outcome({ ...event, activityRunId: 'next-run', activitySequence: 201 });
  expect(f.observed.at(-1)).toMatchObject({ appRunId: 'next', sequence: 1 });
});

it('dispose rejects new contacts and terminal callbacks without persistence or observer effects', () => {
  const f = fixture(); f.recorder.beginInput(false, 10); f.recorder.dispose();
  f.recorder.outcome(event); f.recorder.beginInput(true, 20);
  expect(f.observed).toHaveLength(0); expect(f.append).not.toHaveBeenCalled();
});
