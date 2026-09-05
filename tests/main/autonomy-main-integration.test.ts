import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { IPrng } from '../../src/domain/behavior';
import { MainAutonomyComposition } from '../../src/main/main-autonomy-composition';

class Scheduler {
  public nowMs = 0;
  private nextId = 0;
  private readonly tasks = new Map<
    number,
    { readonly dueAtMs: number; readonly callback: () => void }
  >();

  public setTimeout(callback: () => void, delayMs: number): unknown {
    const id = ++this.nextId;
    this.tasks.set(id, { dueAtMs: this.nowMs + delayMs, callback });
    return id;
  }

  public clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  public take(): (() => void) | undefined {
    const next = [...this.tasks.entries()]
      .sort((left, right) => left[1].dueAtMs - right[1].dueAtMs)[0];
    if (next === undefined) return undefined;
    this.tasks.delete(next[0]);
    this.nowMs = next[1].dueAtMs;
    return next[1].callback;
  }

  public size(): number {
    return this.tasks.size;
  }
}

function sequence(...values: number[]): IPrng {
  let index = 0;
  return { next: () => values[index++] ?? 0 };
}

function createFixture(random: IPrng = sequence(0, 0.4, 0.9, 0.5, 0)) {
  const scheduler = new Scheduler();
  const requestVoluntaryMovement = vi.fn(() => true);
  const cancelVoluntaryMovement = vi.fn(() => false);
  const onPresentationChanged = vi.fn();
  let episodeSequence = 0;
  const composition = new MainAutonomyComposition({
    clock: { now: () => scheduler.nowMs },
    scheduler,
    prng: random,
    prngMetadata: { algorithm: 'sequence', seed: 1 },
    getCharacterSnapshot: () => ({
      needs: { energy: 70, attention: 20, play: 20, comfort: 20, boredom: 20 },
      synthesizedTone: 'neutral',
    }),
    movement: {
      getRootPosition: () => ({ x: 100, y: 200 }),
      getBounds: () => ({ id: 'primary', x: 0, y: 0, width: 1_000, height: 800 }),
      getCollisionInsets: () => ({ left: 50, right: 50, top: 90, bottom: 10 }),
      canAcceptVoluntaryMovement: () => true,
      requestVoluntaryMovement,
      cancelVoluntaryMovement,
    },
    requestManualRootPosition: () => true,
    createVisualEpisodeId: () => `episode-${++episodeSequence}`,
    onPresentationChanged,
    behaviorConfig: {
      minIdleDurationMs: 10,
      maxIdleDurationMs: 10,
      minWanderDurationMs: 20,
      maxWanderDurationMs: 1_000,
      wanderSpeedPxPerSec: 100,
      napProbability: 0.15,
      maxWanderDistancePx: 100,
    },
  });
  return {
    scheduler,
    composition,
    requestVoluntaryMovement,
    cancelVoluntaryMovement,
    onPresentationChanged,
  };
}

describe('Main integration: AUTO-I07 Brain-owned presentation', () => {
  it('preserves idle and walk while creating ordered Brain-owned visual episodes', () => {
    const fixture = createFixture();
    const initial = fixture.composition.getVisualEpisode();
    expect(initial).toMatchObject({ id: 'episode-1', startedAtMs: 0 });
    expect(initial.intent.kind).toBe('idle_blink');

    fixture.composition.start();
    fixture.scheduler.take()?.();

    expect(fixture.requestVoluntaryMovement).toHaveBeenCalledOnce();
    expect(fixture.composition.getVisualEpisode().intent.kind).toBe('walk');
    expect(fixture.composition.getVisualEpisode().id).toBe('episode-2');
    expect(fixture.onPresentationChanged).toHaveBeenCalledOnce();
  });

  it('advances sleep and wake semantics without waiting for Skin completion', () => {
    const fixture = createFixture();
    fixture.composition.start();

    expect(fixture.composition.requestSleepWake({ action: 'sleep' })).toBe(true);
    expect(fixture.composition.getVisualEpisode()).toMatchObject({
      id: 'episode-2',
      intent: { kind: 'sleep_start' },
    });
    expect(fixture.scheduler.size()).toBe(0);
    expect(fixture.composition.requestSleepWake({ action: 'sleep' })).toBe(false);

    expect(fixture.composition.requestSleepWake({ action: 'wake' })).toBe(true);
    expect(fixture.composition.getVisualEpisode()).toMatchObject({
      id: 'episode-3',
      intent: { kind: 'wake_up' },
    });
    expect(fixture.scheduler.size()).toBe(1);
  });

  it('creates a fresh episode for each intentional click replay', () => {
    const fixture = createFixture();

    expect(fixture.composition.handleClick()).toBe(true);
    const firstClick = fixture.composition.getVisualEpisode();
    expect(firstClick.intent.kind).toBe('happy_reaction');
    expect(fixture.composition.handleClick()).toBe(true);
    const secondClick = fixture.composition.getVisualEpisode();

    expect(secondClick.intent.kind).toBe('happy_reaction');
    expect(secondClick.id).not.toBe(firstClick.id);
    expect(fixture.onPresentationChanged).toHaveBeenCalledTimes(2);
  });

  it('keeps forced drag, fall, and landing progression independent from Body outcomes', () => {
    const fixture = createFixture();
    fixture.composition.start();

    fixture.composition.handleMotionEvent({ type: 'drag_started', atMs: 10 });
    expect(fixture.composition.getVisualEpisode().intent.kind).toBe('dragged');
    expect(fixture.scheduler.size()).toBe(0);

    fixture.composition.handleMotionEvent({
      type: 'airborne_started',
      cause: 'throw_release',
      atMs: 20,
    });
    expect(fixture.composition.getVisualEpisode().intent.kind).toBe('fall');

    fixture.composition.handleMotionEvent({
      type: 'landed',
      outcome: 'soft_landing',
      impactSeverity: 10,
    });
    expect(fixture.composition.getVisualEpisode().intent.kind).toBe('land');
    expect(fixture.scheduler.size()).toBe(1);
  });

  it('contains no legacy lifecycle watchdog or callback surface', () => {
    const source = readFileSync(
      new URL('../../src/main/main-autonomy-composition.ts', import.meta.url),
      'utf8'
    );
    expect(source).not.toMatch(/watchdog|lifecycle result|terminal outcome/i);
  });
});
