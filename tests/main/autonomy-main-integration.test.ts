import type { ProviderBehaviorOffer } from '../../src/application/ports/behavior-admission-port';
import type { SurfaceSnapshotDto } from '../../src/domain/behavior/surface-kinematics';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CURSOR_OBSERVE_COOLDOWN_MS,
  DEFAULT_ZOOMIES_COOLDOWN_MS,
  type IPrng,
} from '../../src/domain/behavior';
import type { Needs } from '../../src/domain/character';
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

function createFixture(
  random: IPrng = sequence(0, 0.2, 0.9, 0.5, 0),
  needs: Partial<Needs> = {},
  cancelMovementResults: readonly boolean[] = [],
  externalSurface?: SurfaceSnapshotDto
) {
  const scheduler = new Scheduler();
  const requestVoluntaryMovement = vi.fn(() => true);
  const pendingCancelMovementResults = [...cancelMovementResults];
  const cancelVoluntaryMovement = vi.fn(
    () => pendingCancelMovementResults.shift() ?? false
  );
  const onPresentationChanged = vi.fn();
  const tickNeeds = vi.fn();
  let episodeSequence = 0;
  let activitySequence = 0;
  const composition = new MainAutonomyComposition({
    clock: { now: () => scheduler.nowMs },
    scheduler,
    prng: random,
    prngMetadata: { algorithm: 'sequence', seed: 1 },
    getCharacterSnapshot: () => ({
      needs: {
        energy: 70,
        attention: 20,
        play: 60,
        comfort: 20,
        boredom: 80,
        ...needs,
      },
      relationship: { friendship: 0 },
      synthesizedTone: 'neutral',
    }),
    tickNeeds,
    brainLoopPolicy: { needsTickIntervalMs: 100, maxNeedsCatchUpSteps: 2 },
    movement: {
      getRootPosition: () => ({ x: 100, y: 200 }),
      getBounds: () => ({ id: 'primary', x: 0, y: 0, width: 1_000, height: 800 }),
      getEnvironmentSnapshot: () => ({
        capturedAtMs: scheduler.nowMs,
        screenBounds: { id: 'primary', x: 0, y: 0, width: 1_000, height: 800 },
        currentSurface: externalSurface ?? {
          id: 'primary-floor', kind: 'screen_floor',
          bounds: { x: 0, y: 0, width: 1_000, height: 800 },
          supportY: 800, isValidSupport: true,
        },
      }),
      getCollisionInsets: () => ({ left: 50, right: 50, top: 90, bottom: 10 }),
      canAcceptVoluntaryMovement: () => true,
      requestVoluntaryMovement,
      cancelVoluntaryMovement,
    },
    requestManualRootPosition: () => true,
    createVisualEpisodeId: () => `episode-${++episodeSequence}`,
    createActivityRunId: () => `run-${++activitySequence}`,
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
    tickNeeds,
  };
}

describe('Main integration: Brain runtime', () => {
  it('releases only dialogue-owned thinking and offers a reply through Character gates', () => {
    const f = createFixture(); f.composition.start();
    f.composition.setBehaviorContext({ requestId: 'request', conversationId: 'c', generation: 0, requestedAtMs: f.scheduler.nowMs }); f.composition.beginDialogueThinking('request');
    expect(f.composition.getVisualEpisode().intent.kind).toBe('idle_blink');
    f.composition.endDialogueThinking('foreign');
    expect(f.composition.getVisualEpisode().intent.kind).toBe('idle_blink');
    f.composition.endDialogueThinking('request');
    expect(f.composition.getVisualEpisode().intent.kind).toBe('idle_blink');
    f.composition.offerDialogueIntent(providerOffer('respond', 'request', f.scheduler.nowMs));
    expect(f.composition.getVisualEpisode().intent.kind).toBe('talking'); f.composition.dispose();
  });
  it('does not let a late dialogue result overwrite user input or forced motion', () => {
    const f = createFixture(); f.composition.start(); f.composition.setBehaviorContext({ requestId: 'request', conversationId: 'c', generation: 0, requestedAtMs: f.scheduler.nowMs }); f.composition.beginDialogueThinking('request');
    f.composition.handleClick(); const clicked = f.composition.getVisualEpisode();
    const intent = providerOffer('respond', 'request', f.scheduler.nowMs);
    f.composition.endDialogueThinking('request'); f.composition.offerDialogueIntent(intent);
    expect(f.composition.getVisualEpisode()).toEqual(clicked);
    f.composition.beginDialogueThinking('next'); f.composition.handleMotionEvent({ type: 'drag_started', atMs: 10 });
    f.composition.endDialogueThinking('next'); f.composition.offerDialogueIntent(providerOffer('respond', 'next', f.scheduler.nowMs));
    expect(f.composition.getVisualEpisode().intent.kind).toBe('dragged'); f.composition.dispose();
  });
  it('preserves user sleep when a provider proposes an active response', () => {
    const f = createFixture(); f.composition.start(); f.composition.requestSleepWake({ action: 'sleep' });
    const sleeping = f.composition.getActivityTimeline(); f.composition.setBehaviorContext({ requestId: 'request', conversationId: 'c', generation: 0, requestedAtMs: f.scheduler.nowMs }); f.composition.beginDialogueThinking('request');
    f.composition.endDialogueThinking('request');
    f.composition.offerDialogueIntent(providerOffer('play', 'request', f.scheduler.nowMs));
    expect(f.composition.getActivityTimeline()).toEqual(sleeping); f.composition.dispose();
  });
  it('restores full sleep at the Character energy threshold and exposes recovery only during sleep', () => {
    const needs = { energy: 10 };
    const f = createFixture(sequence(0), needs);
    f.composition.start(); f.scheduler.take()?.();
    expect(f.composition.isSleepingForRecovery()).toBe(false);
    f.composition.notifyVoluntaryMovementCompleted();
    for (const ms of [1500, 3500, 7000]) { f.scheduler.nowMs = ms; f.composition.tick(); }
    expect(f.composition.isSleepingForRecovery()).toBe(true);
    needs.energy = 80; f.scheduler.nowMs = 7100; f.composition.tick();
    expect(f.composition.isSleepingForRecovery()).toBe(false);
    expect(f.composition.getVisualEpisode().intent.kind).toBe('wake_up');
    expect(f.scheduler.size()).toBe(1); f.composition.stop();
  });

  it('ends an autonomous nap awake and resumes the single opportunity scheduler', () => {
    const f = createFixture(sequence(0, .95), { energy: 70, boredom: 40, play: 30 });
    f.composition.start(); f.scheduler.take()?.();
    expect(f.composition.getActivityTimeline()?.activityId).toBe('rest_spot_nap');
    f.composition.notifyVoluntaryMovementCompleted();
    for (const ms of [1500, 3500, 16000, 18000, 21000]) { f.scheduler.nowMs = ms; f.composition.tick(); }
    expect(f.composition.getActivityTimeline()).toBeNull();
    expect(f.composition.requestSleepWake({ action: 'wake' })).toBe(false);
    expect(f.scheduler.size()).toBe(1);
    f.composition.stop();
  });
  it('critical fatigue preserves sleep after preparation; disabling autonomy cancels stable sleep', () => {
    const f = createFixture(sequence(0), { energy: 10 });
    f.composition.start(); f.scheduler.take()?.();
    expect(f.composition.getActivityTimeline()?.activityId).toBe('rest_spot_sleep');
    f.composition.notifyVoluntaryMovementCompleted();
    for (const ms of [1500, 3500, 7000]) { f.scheduler.nowMs = ms; f.composition.tick(); }
    expect(f.composition.getActivityTimeline()).toBeNull();
    expect(f.composition.getVisualEpisode().intent.kind).toBe('sleep_loop');
    expect(f.scheduler.size()).toBe(0);
    f.composition.setEnabled(false);
    expect(f.composition.getVisualEpisode().intent.kind).toBe('idle_blink');
    expect(f.composition.requestSleepWake({ action: 'wake' })).toBe(false);
    f.composition.stop();
  });

  it('resumes the normal scheduler after window landing without a perch activity', () => {
    const surface: SurfaceSnapshotDto = { id: 'window', kind: 'window_top', bounds: { x: 90, y: 200, width: 400, height: 200 }, supportY: 200, isValidSupport: true };
    const f = createFixture(undefined, {}, [], surface);
    f.composition.start(); f.composition.beginDrag();
    f.composition.handleMotionEvent({ type: 'landed', outcome: 'soft_landing', impactSeverity: 0 });
    f.composition.handleWindowSupportAttached();
    expect(f.composition.getActivityTimeline()).toBeNull();
    expect(f.composition.getVisualEpisode().intent.kind).toBe('land');
    expect(f.scheduler.size()).toBe(1);
    f.composition.stop();
  });
  it('keeps ordinary sleep on a window and preserves the activity on attach', () => {
    const surface: SurfaceSnapshotDto = { id: 'window', kind: 'window_top', bounds: { x: 90, y: 200, width: 400, height: 200 }, supportY: 200, isValidSupport: true };
    const floor = createFixture();
    const window = createFixture(undefined, {}, [], surface);
    for (const f of [floor, window]) { f.composition.start(); f.composition.requestSleepWake({ action: 'sleep' }); }
    expect(window.composition.getActivityTimeline()?.activityId).toBe(floor.composition.getActivityTimeline()?.activityId);
    const active = window.composition.getActivityTimeline();
    window.composition.handleWindowSupportAttached();
    expect(window.composition.getActivityTimeline()).toEqual(active);
    for (const ms of [1500, 3500, 7000]) {
      for (const f of [floor, window]) { f.scheduler.nowMs = ms; f.composition.tick(); }
      expect(window.composition.getVisualEpisode().intent.kind).toBe(floor.composition.getVisualEpisode().intent.kind);
    }
    floor.composition.stop(); window.composition.stop();
  });
  it('support loss wakes semantic sleep before the fall lifecycle', () => {
    const f = createFixture(); f.composition.start();
    expect(f.composition.requestSleepWake({ action: 'sleep' })).toBe(true);
    f.composition.handleSupportLost();
    expect(f.composition.requestSleepWake({ action: 'wake' })).toBe(false);
    expect(f.composition.getActivityTimeline()).toBeNull();
    f.composition.stop();
  });

  it('publishes the common gaze-only tier without changing root position', () => {
    const fixture = createFixture(sequence(0.5, 0, 0.99));
    fixture.composition.start();

    expect(fixture.composition.handleCursorObservation({ x: 200, y: 200 })).toBe(true);
    expect(fixture.composition.getActivityTimeline()).toMatchObject({
      activityId: 'observe_cursor', phaseEndsAtMs: 900,
    });
    expect(fixture.composition.getVisualEpisode().intent).toMatchObject({
      kind: 'idle_blink', expressionHint: 'gaze', gazeDirection: 'right',
    });
    expect(fixture.requestVoluntaryMovement).not.toHaveBeenCalled();

    fixture.scheduler.nowMs = 900;
    fixture.composition.tick();
    expect(fixture.composition.getVisualEpisode().intent).toMatchObject({
      kind: 'idle_blink', expressionHint: 'idle',
    });
    expect(fixture.composition.getVisualEpisode().intent.gazeDirection).toBeUndefined();
  });

  it('runs a noticed cursor gesture as one stationary Brain Activity and returns to autonomy', () => {
    const fixture = createFixture(sequence(0.5, 0, 0));
    fixture.composition.start();

    expect(fixture.composition.handleCursorObservation({ x: 110, y: 200 })).toBe(true);
    expect(fixture.composition.getActivityTimeline()).toMatchObject({
      activityId: 'observe_cursor', phaseId: 'react', stage: 'looping', phaseEndsAtMs: 1_800,
    });
    expect(fixture.composition.getVisualEpisode().intent).toMatchObject({
      kind: 'wave', expressionHint: 'curious', loop: 'bounded',
    });
    expect(fixture.requestVoluntaryMovement).not.toHaveBeenCalled();
    expect(fixture.scheduler.size()).toBe(0);

    fixture.scheduler.nowMs = 1_800;
    fixture.composition.tick();
    expect(fixture.composition.getActivityTimeline()).toBeNull();
    expect(fixture.composition.getVisualEpisode().intent.kind).toBe('idle_blink');
    expect(fixture.scheduler.size()).toBe(1);
    expect(fixture.composition.handleCursorObservation({ x: 110, y: 200 })).toBe(false);

    fixture.scheduler.nowMs = DEFAULT_CURSOR_OBSERVE_COOLDOWN_MS;
    expect(fixture.composition.handleCursorObservation({ x: 110, y: 200 })).toBe(true);
  });

  it('suppresses cursor reactions while another Activity owns the Brain timeline', () => {
    const fixture = createFixture();
    fixture.composition.start();
    fixture.scheduler.take()?.();
    const timeline = fixture.composition.getActivityTimeline();
    expect(timeline?.activityId).toBe('explore');

    expect(fixture.composition.handleCursorObservation({ x: 110, y: 200 })).toBe(false);
    expect(fixture.composition.getActivityTimeline()).toEqual(timeline);
  });

  it.each([
    ['click', (composition: MainAutonomyComposition) => composition.handleClick()],
    ['drag', (composition: MainAutonomyComposition) => composition.beginDrag()],
    ['menu pause', (composition: MainAutonomyComposition) => composition.setMenuOpen(true)],
    ['autonomy disable', (composition: MainAutonomyComposition) => composition.setEnabled(false)],
    ['shutdown', (composition: MainAutonomyComposition) => composition.dispose()],
  ])('interrupts Observe Cursor on %s', (_label, interrupt) => {
    const fixture = createFixture(sequence(0.5, 0, 0));
    fixture.composition.start();
    expect(fixture.composition.handleCursorObservation({ x: 110, y: 200 })).toBe(true);

    interrupt(fixture.composition);

    expect(fixture.composition.getActivityTimeline()).toBeNull();
    expect(fixture.requestVoluntaryMovement).not.toHaveBeenCalled();
  });

  it('starts Explore from the Character-resolved wander and exposes its causal timeline', () => {
    const fixture = createFixture();
    const initial = fixture.composition.getVisualEpisode();
    expect(initial).toMatchObject({ id: 'episode-1', startedAtMs: 0 });
    expect(initial.intent.kind).toBe('idle_blink');

    fixture.composition.start();
    fixture.scheduler.take()?.();

    const plan = fixture.composition.getExplorePlan();
    expect(plan).not.toBeNull();
    expect(fixture.requestVoluntaryMovement).toHaveBeenCalledWith({
      kind: 'horizontal_wander',
      targetRootPosition: plan?.targetRootPosition,
      speedPxPerSec: 100,
    });
    expect(fixture.composition.getVisualEpisode().intent.kind).toBe('walk');
    expect(fixture.composition.getVisualEpisode().id).toBe('episode-2');
    expect(fixture.composition.getActivityTimeline()).toEqual({
      runId: 'run-1', activityId: 'explore', phaseId: 'walk', stage: 'entering',
      startedAtMs: 10, phaseStartedAtMs: 10, phaseEndsAtMs: 7_010,
    });
    expect(fixture.onPresentationChanged).toHaveBeenCalledOnce();

    fixture.composition.notifyVoluntaryMovementCompleted();
    expect(fixture.composition.getActivityTimeline()).toMatchObject({
      runId: 'run-1', phaseId: 'inspect', stage: 'looping',
      phaseStartedAtMs: 10, phaseEndsAtMs: 2_210,
    });
    expect(fixture.composition.getVisualEpisode().intent.kind).toBe(plan?.inspection);

    for (let index = 0; index < 3; index += 1) {
      const timeline = fixture.composition.getActivityTimeline();
      if (timeline === null || timeline.phaseEndsAtMs === null) break;
      fixture.scheduler.nowMs = timeline.phaseEndsAtMs;
      fixture.composition.tick();
    }
    expect(fixture.composition.getActivityTimeline()).toBeNull();
    expect(fixture.composition.getExplorePlan()).toBeNull();
    expect(fixture.composition.getVisualEpisode().intent.kind).toBe('idle_blink');
    expect(fixture.requestVoluntaryMovement).toHaveBeenCalledOnce();
    expect(fixture.scheduler.size()).toBe(1);
  });

  it('advances user Rest through route and Brain phases, then wakes', () => {
    const f = createFixture(); f.composition.start();
    expect(f.composition.requestSleepWake({ action: 'sleep' })).toBe(true);
    expect(f.composition.getActivityTimeline()?.activityId).toBe('rest_spot_sleep');
    f.composition.notifyVoluntaryMovementCompleted();
    for (const ms of [1200, 2700, 5700]) { f.scheduler.nowMs = ms; f.composition.tick(); }
    expect(f.composition.isSleepingForRecovery()).toBe(true);
    expect(f.composition.requestSleepWake({ action: 'wake' })).toBe(true);
    expect(f.composition.getActivityTimeline()).toBeNull();
    expect(f.composition.getVisualEpisode().intent.kind).toBe('wake_up');
    expect(f.scheduler.size()).toBe(1);
  });

  it('starts Zoomies only after a Character-resolved play intent', () => {
    const fixture = createFixture();
    fixture.composition.start();
    fixture.composition.suspendForUserInteraction();

    expect(fixture.composition.handleCharacterInteraction('play')).toBe(true);
    fixture.composition.resumeAfterUserInteraction();
    expect(fixture.composition.getActivityTimeline()).toMatchObject({
      activityId: 'zoomies', phaseId: 'sprint', stage: 'looping',
    });
    expect(fixture.composition.getVisualEpisode().intent.kind).toBe('run');
    expect(fixture.requestVoluntaryMovement).toHaveBeenCalledOnce();
    expect(fixture.scheduler.size()).toBe(0);

    fixture.composition.notifyVoluntaryMovementCompleted();
    expect(fixture.composition.getActivityTimeline()).toMatchObject({
      phaseId: 'settle', stage: 'exiting', phaseEndsAtMs: 3_000,
    });
    fixture.scheduler.nowMs = 3_000;
    fixture.composition.tick();
    expect(fixture.composition.getActivityTimeline()).toBeNull();
    expect(fixture.composition.getVisualEpisode().intent.kind).toBe('idle_blink');
    expect(fixture.scheduler.size()).toBe(1);
  });

  it('rejects Zoomies when Domain needs gates do not allow resolved play', () => {
    const fixture = createFixture(undefined, { energy: 64 });
    fixture.composition.start();
    fixture.composition.suspendForUserInteraction();

    expect(fixture.composition.handleCharacterInteraction('play')).toBe(false);
    fixture.composition.resumeAfterUserInteraction();
    expect(fixture.composition.getActivityTimeline()).toBeNull();
    expect(fixture.requestVoluntaryMovement).not.toHaveBeenCalled();
    expect(fixture.scheduler.size()).toBe(1);
  });

  it('keeps repeated Zoomies blocked until its monotonic Domain cooldown expires', () => {
    const fixture = createFixture();
    fixture.composition.start();
    fixture.composition.suspendForUserInteraction();
    expect(fixture.composition.handleCharacterInteraction('play')).toBe(true);
    fixture.composition.resumeAfterUserInteraction();
    fixture.composition.handleClick();

    fixture.composition.suspendForUserInteraction();
    expect(fixture.composition.handleCharacterInteraction('play')).toBe(false);
    fixture.composition.resumeAfterUserInteraction();

    fixture.scheduler.nowMs = DEFAULT_ZOOMIES_COOLDOWN_MS;
    fixture.composition.suspendForUserInteraction();
    expect(fixture.composition.handleCharacterInteraction('play')).toBe(true);
  });

  it('commits cancellation of a user Rest route', () => {
    const fixture = createFixture();
    fixture.composition.start();
    expect(fixture.composition.requestSleepWake({ action: 'sleep' })).toBe(true);
    expect(fixture.composition.getVisualEpisode().intent.kind).toBe('walk');
    fixture.onPresentationChanged.mockClear();

    fixture.composition.setMenuOpen(true);

    expect(fixture.composition.getActivityTimeline()).toBeNull();
    expect(fixture.composition.getVisualEpisode().intent.kind).toBe('idle_blink');
    expect(fixture.onPresentationChanged).toHaveBeenCalledOnce();
  });

  it('publishes one coherent cancellation when stopping active movement succeeds', () => {
    const fixture = createFixture(undefined, {}, [true]);
    fixture.composition.start();
    fixture.scheduler.take()?.();
    expect(fixture.composition.getActivityTimeline()?.activityId).toBe('explore');
    expect(fixture.composition.getVisualEpisode().intent.kind).toBe('walk');
    fixture.onPresentationChanged.mockClear();

    fixture.composition.setEnabled(false);

    expect(fixture.composition.getActivityTimeline()).toBeNull();
    expect(fixture.composition.getVisualEpisode().intent.kind).toBe('idle_blink');
    expect(fixture.cancelVoluntaryMovement).toHaveNthReturnedWith(1, true);
    expect(fixture.onPresentationChanged).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'menu pause',
      (composition: MainAutonomyComposition) => composition.setMenuOpen(true),
      (composition: MainAutonomyComposition) => composition.setMenuOpen(false),
    ],
    [
      'autonomy disable',
      (composition: MainAutonomyComposition) => composition.setEnabled(false),
      (composition: MainAutonomyComposition) => composition.setEnabled(true),
    ],
  ])('restores cadence after %s interrupts deferred Zoomies', (_label, pause, resume) => {
    const fixture = createFixture();
    fixture.composition.start();
    fixture.composition.suspendForUserInteraction();
    expect(fixture.composition.handleCharacterInteraction('play')).toBe(true);
    fixture.composition.resumeAfterUserInteraction();
    expect(fixture.composition.getActivityTimeline()?.activityId).toBe('zoomies');

    pause(fixture.composition);
    expect(fixture.composition.getActivityTimeline()).toBeNull();
    expect(fixture.scheduler.size()).toBe(0);

    resume(fixture.composition);
    expect(fixture.scheduler.size()).toBe(1);
  });

  it('ticks needs from bounded accumulated Brain-loop delta', () => {
    const fixture = createFixture();
    fixture.composition.start();

    fixture.scheduler.nowMs = 550;
    expect(fixture.composition.tick()).toBe(true);
    expect(fixture.tickNeeds.mock.calls).toEqual([[100], [100]]);
    expect(fixture.composition.tick()).toBe(false);
    fixture.scheduler.nowMs = 650;
    fixture.composition.tick();
    expect(fixture.tickNeeds.mock.calls).toEqual([[100], [100], [100]]);
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

  it('maps the Body think interaction through the Domain-owned intent gate', () => {
    const fixture = createFixture();

    expect(fixture.composition.handleCharacterInteraction('think')).toBe(true);

    expect(fixture.composition.getVisualEpisode().intent).toMatchObject({
      kind: 'thinking_loop',
      requestedBy: 'system',
    });
    expect(fixture.onPresentationChanged).toHaveBeenCalledOnce();
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

  it.each([
    ['click', (composition: MainAutonomyComposition) => composition.handleClick()],
    ['drag', (composition: MainAutonomyComposition) => composition.beginDrag()],
    ['forced motion', (composition: MainAutonomyComposition) => composition.handleMotionEvent({
      type: 'airborne_started', cause: 'support_lost', atMs: 20,
    })],
    ['menu pause', (composition: MainAutonomyComposition) => composition.setMenuOpen(true)],
    ['autonomy disable', (composition: MainAutonomyComposition) => composition.setEnabled(false)],
    ['support loss', (composition: MainAutonomyComposition) => composition.handleSupportLost()],
    ['shutdown', (composition: MainAutonomyComposition) => composition.dispose()],
  ])('cancels the active Activity on %s without a second owner', (_label, interrupt) => {
    const fixture = createFixture();
    fixture.composition.start();
    fixture.scheduler.take()?.();
    expect(fixture.composition.getActivityTimeline()?.activityId).toBe('explore');

    interrupt(fixture.composition);

    expect(fixture.composition.getActivityTimeline()).toBeNull();
    expect(fixture.cancelVoluntaryMovement).toHaveBeenCalled();
  });

  it('contains no legacy lifecycle watchdog or callback surface', () => {
    const source = readFileSync(
      new URL('../../src/main/main-autonomy-composition.ts', import.meta.url),
      'utf8'
    );
    expect(source).not.toMatch(/watchdog|lifecycle result|terminal outcome/i);
  });
});

function providerOffer(kind: 'respond' | 'play', requestId: string, nowMs: number): ProviderBehaviorOffer {
  return { intent: { kind, requestId, source: 'provider', priority: 'normal' }, conversationId: 'c', generation: 0,
    requestedAtMs: nowMs, receivedAtMs: nowMs, expiresAtMs: nowMs + 30000 };
}
