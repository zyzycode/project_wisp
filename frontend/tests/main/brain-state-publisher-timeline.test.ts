import { describe, expect, it, vi } from 'vitest';
import { ActivityRunner, REST_ACTIVITY, type ActivityRuntimeState } from '../../src/domain/behavior/activity-runner';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { BrainStatePublisher, type BrainStateSnapshotMeta } from '../../src/main/brain-state-publisher';
import { toBrainStateDTO } from '../../src/main/mappers/shimeji-ipc.mapper';
import type { BrainStateDTO } from '../../src/shared/ipc-contracts';

function fixture() {
  const runner = new ActivityRunner();
  let runtime: ActivityRuntimeState | undefined = runner.start(REST_ACTIVITY, 'rest-1', 0).runtime;
  let nowMs = 2999;
  const delivered: BrainStateDTO[] = [];
  const character = new CharacterStateService({ now: () => 0 });
  const options = {
    now: () => nowMs,
    createStreamId: () => 'stream-1',
    prepareSnapshot: () => {
      if (runtime) runtime = runner.tick(REST_ACTIVITY, runtime, publisher.now()).runtime;
    },
    createSnapshot: (meta: BrainStateSnapshotMeta) => toBrainStateDTO({
      ...meta, character: character.getSnapshot(),
      dialogue: { conversationId: 'c', canSubmit: true, turn: { phase: 'idle' } },
      autonomy: { quiet: false }, cursorGame: null,
      activity: runtime ? { runId: runtime.runId, activityId: runtime.activityId,
        phaseId: runtime.currentStepId, stage: runtime.stage, startedAtMs: runtime.startedAtMs,
        phaseStartedAtMs: runtime.stepStartedAtMs, phaseEndsAtMs: runtime.phaseEndsAtMs } : null,
      motion: { phase: 'grounded', position: { x: 0, y: 0 }, velocityPxPerSec: { x: 0, y: 0 },
        activeBoundsId: 'screen', airborneElapsedSec: 0, peakGroundImpactSeverity: 0 },
      visualEpisode: { id: `episode-${runtime?.currentStepId ?? 'idle'}`, sequence: meta.revision,
        startedAtMs: runtime?.stepStartedAtMs ?? meta.sampledAtMs,
        intent: { kind: 'idle_blink', category: 'idle', priority: 'low', interrupt: 'limited',
          loop: 'until_replaced', emotionalTone: 'neutral', requestedBy: 'system' } },
    }),
    deliver: (state: BrainStateDTO) => { delivered.push(state); },
    revisionSink: { replaceStream: vi.fn(), clearStream: vi.fn(), advanceRevision: vi.fn() },
  };
  const publisher: BrainStatePublisher = new BrainStatePublisher(options);
  return { publisher, delivered, options, setTime: (time: number) => { nowMs = time; } };
}

describe('Brain snapshot activity deadlines', () => {
  it.each([3000, 60000])('advances a phase before publishing at %i ms between motion ticks', async (nowMs) => {
    const f = fixture();
    f.publisher.replaceStream();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.delivered[0]?.activity?.phaseId).toBe('yawn');

    f.setTime(nowMs);
    expect(() => f.publisher.requestCommit()).not.toThrow();
    await Promise.resolve();
    expect(f.delivered.at(-1)).toMatchObject({ sampledAtMs: nowMs, revision: 2,
      activity: { phaseId: 'lie_down', phaseStartedAtMs: nowMs, phaseEndsAtMs: nowMs + 3000 } });
  });

  it('uses the snapshot time even when preparation crosses another deadline', async () => {
    const f = fixture();
    const prepare = f.options.prepareSnapshot;
    f.options.prepareSnapshot = () => {
      f.setTime(9000);
      prepare();
    };
    f.setTime(3000);
    expect(() => f.publisher.replaceStream()).not.toThrow();
    await Promise.resolve();
    expect(f.delivered[0]).toMatchObject({ sampledAtMs: 3000,
      activity: { phaseId: 'lie_down', phaseStartedAtMs: 3000, phaseEndsAtMs: 6000 },
      visualIntent: { episodeStartedAtMs: 3000 } });
    expect(f.publisher.now()).toBe(9000);
  });

  it('includes synchronous notifications in one final transaction snapshot', async () => {
    const f = fixture();
    f.publisher.replaceStream();
    await Promise.resolve();
    await Promise.resolve();
    const prepare = f.options.prepareSnapshot;
    f.options.prepareSnapshot = vi.fn(() => {
      prepare();
      f.publisher.requestCommit();
    });
    f.publisher.beginTransaction();
    f.publisher.requestCommit();
    f.setTime(3000);
    expect(() => f.publisher.commitTransaction()).not.toThrow();
    await Promise.resolve();
    expect(f.options.prepareSnapshot).toHaveBeenCalledOnce();
    expect(f.delivered.map(state => state.revision)).toEqual([1, 2]);
    expect(f.delivered[1]?.activity?.phaseId).toBe('lie_down');
  });

  it('restores live time and permits another commit after preparation fails', async () => {
    const f = fixture();
    const prepare = f.options.prepareSnapshot;
    f.options.prepareSnapshot = () => {
      f.setTime(3001);
      throw new Error('source unavailable');
    };
    expect(() => f.publisher.replaceStream()).toThrow('source unavailable');
    expect(f.publisher.now()).toBe(3001);
    f.options.prepareSnapshot = prepare;
    f.publisher.requestCommit();
    await Promise.resolve();
    expect(f.delivered[0]).toMatchObject({ sampledAtMs: 3001, revision: 1,
      activity: { phaseId: 'lie_down' } });
  });
});
