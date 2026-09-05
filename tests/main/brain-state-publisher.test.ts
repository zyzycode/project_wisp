import { describe, expect, it, vi } from 'vitest';
import type { BrainStateDTO } from '../../src/shared/ipc-contracts';
import {
  BrainStatePublisher,
  type BrainStateSnapshotMeta,
} from '../../src/main/brain-state-publisher';

interface ProjectionControls {
  positionX: number;
  phase: BrainStateDTO['motion']['phase'];
  positionAuthority: BrainStateDTO['motion']['positionAuthority'];
  episodeId: string;
  needsEnergy: number;
}

function snapshot(meta: BrainStateSnapshotMeta, controls: ProjectionControls): BrainStateDTO {
  return {
    ...meta,
    character: {
      needs: {
        energy: controls.needsEnergy,
        attention: 50,
        play: 50,
        comfort: 50,
        boredom: 50,
      },
      synthesizedTone: 'neutral',
    },
    activity: null,
    motion: {
      phase: controls.phase,
      rootScreenPosition: { x: controls.positionX, y: 20 },
      velocityPxPerSec: { x: 1, y: 0 },
      positionAuthority: controls.positionAuthority,
    },
    visualIntent: {
      episodeId: controls.episodeId,
      episodeStartedAtMs: 0,
      kind: 'idle_blink',
      category: 'idle',
      priority: 'low',
      interrupt: 'limited',
      loop: 'until_replaced',
      emotionalTone: 'neutral',
    },
  };
}

function createFixture(
  deliver?: (state: BrainStateDTO) => void | Promise<void>
) {
  const controls: ProjectionControls = {
    positionX: 10,
    phase: 'grounded',
    positionAuthority: 'voluntary',
    episodeId: 'episode-1',
    needsEnergy: 50,
  };
  const scheduled: Array<() => void> = [];
  const delivered: BrainStateDTO[] = [];
  const revisionSink = {
    replaceStream: vi.fn(),
    clearStream: vi.fn(),
    advanceRevision: vi.fn(),
  };
  let nowMs = 100;
  const publisher = new BrainStatePublisher({
    now: () => nowMs++,
    createStreamId: () => 'stream-1',
    createSnapshot: (meta) => snapshot(meta, controls),
    deliver: deliver ?? ((state) => {
      delivered.push(state);
    }),
    revisionSink,
    scheduleFlush: (callback) => scheduled.push(callback),
  });
  const runScheduled = async (): Promise<void> => {
    while (scheduled.length > 0) {
      scheduled.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    }
  };
  return { controls, delivered, publisher, revisionSink, runScheduled, scheduled };
}

describe('Main: Brain state publisher', () => {
  it('publishes the initial snapshot and one final snapshot per transaction', async () => {
    const fixture = createFixture();
    fixture.publisher.replaceStream();
    await fixture.runScheduled();

    fixture.publisher.beginTransaction();
    fixture.controls.positionX = 15;
    fixture.publisher.requestCommit();
    fixture.controls.episodeId = 'episode-2';
    fixture.controls.needsEnergy = 45;
    fixture.publisher.requestCommit();
    expect(fixture.delivered).toHaveLength(1);
    fixture.publisher.commitTransaction();
    await fixture.runScheduled();

    expect(fixture.delivered).toHaveLength(2);
    expect(fixture.delivered[1]).toMatchObject({
      revision: 2,
      character: { needs: { energy: 45 } },
      motion: { rootScreenPosition: { x: 15 } },
      visualIntent: { episodeId: 'episode-2' },
    });
    expect(fixture.revisionSink.advanceRevision.mock.calls).toEqual([[1], [2]]);

    fixture.publisher.requestCommit();
    await fixture.runScheduled();
    expect(fixture.delivered).toHaveLength(2);
  });

  it('coalesces pending motion-only snapshots latest-wins under backpressure', async () => {
    const delivered: BrainStateDTO[] = [];
    let releaseBlocked: (() => void) | undefined;
    const fixture = createFixture((state) => {
      delivered.push(state);
      if (state.revision === 2) {
        return new Promise<void>((resolve) => {
          releaseBlocked = resolve;
        });
      }
      return undefined;
    });
    fixture.publisher.replaceStream();
    await fixture.runScheduled();

    fixture.controls.positionX = 20;
    fixture.publisher.requestCommit();
    fixture.scheduled.shift()?.();
    fixture.controls.positionX = 30;
    fixture.publisher.requestCommit();
    fixture.controls.positionX = 40;
    fixture.publisher.requestCommit();

    expect(delivered.map((state) => state.revision)).toEqual([1, 2]);
    releaseBlocked?.();
    await Promise.resolve();
    await Promise.resolve();
    await fixture.runScheduled();

    expect(delivered.map((state) => state.revision)).toEqual([1, 2, 4]);
    expect(delivered[2]?.motion.rootScreenPosition.x).toBe(40);
    expect(fixture.revisionSink.advanceRevision.mock.calls).toEqual([[1], [2], [4]]);
  });

  it('preserves semantic and position-authority transitions during backpressure', async () => {
    const delivered: BrainStateDTO[] = [];
    let releaseBlocked: (() => void) | undefined;
    const fixture = createFixture((state) => {
      delivered.push(state);
      if (state.revision === 2) {
        return new Promise<void>((resolve) => {
          releaseBlocked = resolve;
        });
      }
      return undefined;
    });
    fixture.publisher.replaceStream();
    await fixture.runScheduled();

    fixture.controls.positionX = 20;
    fixture.publisher.requestCommit();
    fixture.scheduled.shift()?.();
    fixture.controls.episodeId = 'episode-2';
    fixture.publisher.requestCommit();
    fixture.controls.episodeId = 'episode-3';
    fixture.publisher.requestCommit();
    fixture.controls.phase = 'airborne';
    fixture.controls.positionAuthority = 'forced';
    fixture.publisher.requestCommit();

    releaseBlocked?.();
    await Promise.resolve();
    await Promise.resolve();
    await fixture.runScheduled();

    expect(delivered.map((state) => state.revision)).toEqual([1, 2, 3, 4, 5]);
    expect(delivered.slice(2).map((state) => state.visualIntent.episodeId))
      .toEqual(['episode-2', 'episode-3', 'episode-3']);
    expect(delivered[4]?.motion.positionAuthority).toBe('forced');
  });

  it('drops a coalesced motion tail that returns to the delivered projection', async () => {
    const delivered: BrainStateDTO[] = [];
    let releaseBlocked: (() => void) | undefined;
    const fixture = createFixture((state) => {
      delivered.push(state);
      if (state.revision === 2) {
        return new Promise<void>((resolve) => {
          releaseBlocked = resolve;
        });
      }
      return undefined;
    });
    fixture.publisher.replaceStream();
    await fixture.runScheduled();

    fixture.controls.positionX = 20;
    fixture.publisher.requestCommit();
    fixture.scheduled.shift()?.();
    fixture.controls.positionX = 30;
    fixture.publisher.requestCommit();
    fixture.controls.positionX = 20;
    fixture.publisher.requestCommit();
    releaseBlocked?.();
    await Promise.resolve();
    await Promise.resolve();
    await fixture.runScheduled();

    expect(delivered.map((state) => state.revision)).toEqual([1, 2]);
    expect(fixture.revisionSink.advanceRevision.mock.calls).toEqual([[1], [2]]);
  });

  it('invalidates queued work and revision state when the stream is replaced', async () => {
    let streamNumber = 0;
    const scheduled: Array<() => void> = [];
    const delivered: BrainStateDTO[] = [];
    const revisionSink = {
      replaceStream: vi.fn(),
      clearStream: vi.fn(),
      advanceRevision: vi.fn(),
    };
    const controls: ProjectionControls = {
      positionX: 10,
      phase: 'grounded',
      positionAuthority: 'voluntary',
      episodeId: 'episode-1',
      needsEnergy: 50,
    };
    const publisher = new BrainStatePublisher({
      now: () => 100,
      createStreamId: () => `stream-${++streamNumber}`,
      createSnapshot: (meta) => snapshot(meta, controls),
      deliver: (state) => {
        delivered.push(state);
      },
      revisionSink,
      scheduleFlush: (callback) => scheduled.push(callback),
    });

    publisher.replaceStream();
    publisher.replaceStream();
    while (scheduled.length > 0) {
      scheduled.shift()?.();
      await Promise.resolve();
    }

    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ streamId: 'stream-2', revision: 1 });
    expect(revisionSink.replaceStream.mock.calls).toEqual([['stream-1'], ['stream-2']]);
    expect(revisionSink.advanceRevision).toHaveBeenCalledWith(1);
  });
});
