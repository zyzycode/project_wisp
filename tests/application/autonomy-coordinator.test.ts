import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  AutonomyCoordinator,
  type AutonomyScheduler,
  type VoluntaryMovementController,
} from '../../src/application/services/autonomy-coordinator';
import { AutonomyCharacterEngine } from '../../src/domain/character';
import type { IPrng } from '../../src/domain/behavior/autonomous-behavior';

class FakeScheduler implements AutonomyScheduler {
  public nowMs = 0;
  private nextId = 0;
  private readonly pending = new Map<number, { readonly dueAtMs: number; readonly callback: () => void }>();

  public setTimeout(callback: () => void, delayMs: number): unknown {
    const id = ++this.nextId;
    this.pending.set(id, { dueAtMs: this.nowMs + delayMs, callback });
    return id;
  }

  public clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  public advanceBy(deltaMs: number): void {
    const targetMs = this.nowMs + deltaMs;
    while (true) {
      const next = [...this.pending.entries()]
        .filter(([, task]) => task.dueAtMs <= targetMs)
        .sort((left, right) => left[1].dueAtMs - right[1].dueAtMs)[0];
      if (next === undefined) break;
      const [id, task] = next;
      this.pending.delete(id);
      this.nowMs = task.dueAtMs;
      task.callback();
    }
    this.nowMs = targetMs;
  }

  public size(): number {
    return this.pending.size;
  }

  public firstCallback(): (() => void) | undefined {
    return this.pending.values().next().value?.callback;
  }
}

function sequencePrng(...values: number[]): IPrng {
  let index = 0;
  return { next: () => values[index++] ?? values.at(-1) ?? 0 };
}

type MockMovement = Omit<VoluntaryMovementController, 'requestVoluntaryMovement' | 'cancelVoluntaryMovement'> & {
  requestVoluntaryMovement: Mock<VoluntaryMovementController['requestVoluntaryMovement']>;
  cancelVoluntaryMovement: Mock<() => boolean>;
};

function movement(): MockMovement {
  return {
    getRootPosition: () => ({ x: 100, y: 390 }),
    getBounds: () => ({ id: 'primary', x: 0, y: 0, width: 500, height: 400 }),
    getCollisionInsets: () => ({ left: 50, right: 50, top: 90, bottom: 10 }),
    canAcceptVoluntaryMovement: () => true,
    requestVoluntaryMovement: vi.fn(() => true),
    cancelVoluntaryMovement: vi.fn(() => true),
  };
}

function createCoordinator(
  scheduler: FakeScheduler,
  random: IPrng,
  moving: MockMovement = movement(),
  traceCapacity = 32
) {
  const onIntent = vi.fn();
  const onStopped = vi.fn();
  const character = new AutonomyCharacterEngine();
  const coordinator = new AutonomyCoordinator({
    clock: { now: () => scheduler.nowMs },
    scheduler,
    prng: random,
    prngMetadata: { algorithm: 'test-sequence', seed: 17 },
    character,
    getCharacterSnapshot: () => ({
      needs: { energy: 70, attention: 20, play: 20, comfort: 20, boredom: 20 },
      synthesizedTone: 'neutral',
    }),
    movement: moving,
    onIntentResolved: onIntent,
    onMovementStopped: onStopped,
    behaviorConfig: {
      minIdleDurationMs: 10,
      maxIdleDurationMs: 10,
      minWanderDurationMs: 20,
      maxWanderDurationMs: 20,
      wanderSpeedPxPerSec: 1000,
      napProbability: 0.15,
      maxWanderDistancePx: 100,
    },
    traceCapacity,
  });
  return { coordinator, moving, onIntent, onStopped, character };
}

describe('Application: AutonomyCoordinator', () => {
  it('owns one cadence timer and delegates wander as one root command without a movement timer', () => {
    const scheduler = new FakeScheduler();
    const fixture = createCoordinator(scheduler, sequencePrng(0, 0.4, 0.1, 0.9));

    fixture.coordinator.start();
    fixture.coordinator.start();
    expect(scheduler.size()).toBe(1);
    scheduler.advanceBy(10);

    expect(fixture.onIntent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'wander' }),
      { decisionSequence: 1, opportunityAtMs: 10 }
    );
    expect(fixture.moving.requestVoluntaryMovement).toHaveBeenCalledWith({
      kind: 'horizontal_wander',
      targetRootPosition: expect.objectContaining({ y: 390 }),
      speedPxPerSec: 1000,
    });
    expect(scheduler.size()).toBe(0);

    fixture.coordinator.notifyVoluntaryMovementCompleted();
    expect(scheduler.size()).toBe(1);
  });

  it('does not publish wander and restores idle cadence when the root command is rejected', () => {
    const scheduler = new FakeScheduler();
    const rejectedMovement = movement();
    rejectedMovement.requestVoluntaryMovement.mockReturnValue(false);
    const fixture = createCoordinator(
      scheduler,
      sequencePrng(0, 0.4, 0.1, 0.9),
      rejectedMovement
    );

    fixture.coordinator.start();
    scheduler.advanceBy(10);

    expect(fixture.moving.requestVoluntaryMovement).toHaveBeenCalledOnce();
    expect(fixture.onIntent).not.toHaveBeenCalled();
    expect(fixture.onStopped).toHaveBeenCalledOnce();
    expect(fixture.coordinator.getDecisionTrace()[0]).toMatchObject({
      outcomeKind: 'wander',
      outcomeReason: 'movement_command_rejected',
    });
    expect(scheduler.size()).toBe(1);
  });

  it('pauses pending and active autonomy for the menu, then creates exactly one timer on close', () => {
    const scheduler = new FakeScheduler();
    const fixture = createCoordinator(scheduler, sequencePrng(0, 0, 0.4, 0.1, 0.9));
    fixture.coordinator.start();

    fixture.coordinator.setMenuOpen(true);
    expect(scheduler.size()).toBe(0);
    fixture.coordinator.setMenuOpen(false);
    fixture.coordinator.setMenuOpen(false);
    expect(scheduler.size()).toBe(1);

    scheduler.advanceBy(10);
    expect(fixture.moving.requestVoluntaryMovement).toHaveBeenCalledOnce();
    fixture.coordinator.setMenuOpen(true);
    expect(fixture.moving.cancelVoluntaryMovement).toHaveBeenCalled();
    expect(scheduler.size()).toBe(0);
    fixture.coordinator.setMenuOpen(false);
    expect(scheduler.size()).toBe(1);
  });

  it('cleans work and rejects a retained late callback after stop and dispose', () => {
    const scheduler = new FakeScheduler();
    const fixture = createCoordinator(scheduler, sequencePrng(0.4));
    fixture.coordinator.start();
    const lateAfterStop = scheduler.firstCallback();
    fixture.coordinator.stop();
    lateAfterStop?.();
    expect(fixture.onIntent).not.toHaveBeenCalled();
    expect(scheduler.size()).toBe(0);

    fixture.coordinator.start();
    const lateAfterDispose = scheduler.firstCallback();
    fixture.coordinator.dispose();
    lateAfterDispose?.();
    expect(fixture.onIntent).not.toHaveBeenCalled();
    expect(scheduler.size()).toBe(0);
  });

  it('does not restart cadence during forced motion and resumes only through the explicit gate', () => {
    const scheduler = new FakeScheduler();
    const fixture = createCoordinator(scheduler, sequencePrng(0.4));
    fixture.coordinator.start();
    fixture.coordinator.interruptForcedMotion();

    expect(scheduler.size()).toBe(0);
    fixture.coordinator.resumeAfterForcedMotion();
    fixture.coordinator.resumeAfterForcedMotion();
    expect(scheduler.size()).toBe(1);
  });

  it('keeps user-interaction suspension across menu and enable changes until explicit resume', () => {
    const scheduler = new FakeScheduler();
    const fixture = createCoordinator(scheduler, sequencePrng(0.4));
    fixture.coordinator.start();
    fixture.coordinator.suspendForUserInteraction();

    fixture.coordinator.setMenuOpen(true);
    fixture.coordinator.setMenuOpen(false);
    fixture.coordinator.setEnabled(false);
    fixture.coordinator.setEnabled(true);
    expect(scheduler.size()).toBe(0);

    fixture.coordinator.resumeAfterUserInteraction();
    fixture.coordinator.resumeAfterUserInteraction();
    expect(scheduler.size()).toBe(1);
  });

  it('keeps forced-motion suspension across menu and enable changes until explicit resume', () => {
    const scheduler = new FakeScheduler();
    const fixture = createCoordinator(scheduler, sequencePrng(0.4));
    fixture.coordinator.start();
    fixture.coordinator.interruptForcedMotion();

    fixture.coordinator.setMenuOpen(true);
    fixture.coordinator.setMenuOpen(false);
    fixture.coordinator.setEnabled(false);
    fixture.coordinator.setEnabled(true);
    expect(scheduler.size()).toBe(0);

    fixture.coordinator.resumeAfterForcedMotion();
    fixture.coordinator.resumeAfterForcedMotion();
    expect(scheduler.size()).toBe(1);
  });

  it('releases manual-movement suspension on completion or cancellation', () => {
    const scheduler = new FakeScheduler();
    const moving = movement();
    moving.cancelVoluntaryMovement.mockReturnValueOnce(false);
    const fixture = createCoordinator(scheduler, sequencePrng(0.4), moving);
    fixture.coordinator.start();
    fixture.coordinator.suspendForManualMovement();
    expect(scheduler.size()).toBe(0);

    fixture.coordinator.notifyVoluntaryMovementCompleted();
    expect(scheduler.size()).toBe(1);

    moving.cancelVoluntaryMovement.mockReturnValueOnce(false);
    fixture.coordinator.suspendForManualMovement();
    fixture.coordinator.setMenuOpen(true);
    fixture.coordinator.setMenuOpen(false);
    expect(scheduler.size()).toBe(1);
  });

  it.each([
    [
      'user interaction',
      (coordinator: AutonomyCoordinator) => coordinator.suspendForUserInteraction(),
      (coordinator: AutonomyCoordinator) => coordinator.resumeAfterUserInteraction(),
    ],
    [
      'forced motion',
      (coordinator: AutonomyCoordinator) => coordinator.interruptForcedMotion(),
      (coordinator: AutonomyCoordinator) => coordinator.resumeAfterForcedMotion(),
    ],
  ])('keeps %s suspended when overlapping manual movement completes', (_label, suspend, resume) => {
    const scheduler = new FakeScheduler();
    const fixture = createCoordinator(scheduler, sequencePrng(0.4));
    fixture.coordinator.start();
    suspend(fixture.coordinator);
    fixture.coordinator.suspendForManualMovement();

    fixture.coordinator.notifyVoluntaryMovementCompleted();
    expect(scheduler.size()).toBe(0);

    resume(fixture.coordinator);
    expect(scheduler.size()).toBe(1);
  });

  it('uses the fresh Character sleep gate and schedules once after an accepted wake', () => {
    const scheduler = new FakeScheduler();
    const fixture = createCoordinator(scheduler, sequencePrng(0, 0.05));
    fixture.coordinator.start();
    scheduler.advanceBy(10);
    expect(fixture.character.getSemanticSleepState()).toBe('sleeping');
    expect(scheduler.size()).toBe(0);

    fixture.coordinator.suspendForUserInteraction();
    fixture.character.resolveDirectIntent(
      { kind: 'wake', source: 'user', priority: 'critical' },
      {
        needs: { energy: 70, attention: 20, play: 20, comfort: 20, boredom: 20 },
        synthesizedTone: 'neutral',
      }
    );
    fixture.coordinator.resumeAfterUserInteraction();
    fixture.coordinator.resumeAfterUserInteraction();
    expect(scheduler.size()).toBe(1);
  });

  it('keeps a bounded internal trace with sequence, time, candidates, outcome, and seed metadata', () => {
    const scheduler = new FakeScheduler();
    const fixture = createCoordinator(scheduler, sequencePrng(0, 0.95), movement(), 2);
    fixture.coordinator.start();
    scheduler.advanceBy(30);

    const trace = fixture.coordinator.getDecisionTrace();
    expect(trace).toHaveLength(2);
    expect(trace[0]!.decisionSequence).toBeLessThan(trace[1]!.decisionSequence);
    expect(trace[0]!.opportunityAtMs).toBeLessThan(trace[1]!.opportunityAtMs);
    expect(trace[1]).toMatchObject({
      orderedCandidateKinds: ['idle', 'wander', 'sleep'],
      outcomeKind: 'idle',
      prng: { algorithm: 'test-sequence', seed: 17 },
    });
  });
});
