import { describe, expect, it, vi } from 'vitest';
import { ShimejiMotionOrchestrator } from '../../src/application/services';
import {
  MotionEngine,
  SurfaceKinematics,
  type IPrng,
  type MotionEvent,
  type Vector2Dto,
} from '../../src/domain/behavior';
import { AnimationStateMachine } from '../../src/domain/animation';
import {
  AnimationPlayer,
  type ICharacterRenderer,
  type ResolvedAnimationClip,
} from '../../src/renderer/render-engine';
import { MainAutonomyComposition } from '../../src/main/main-autonomy-composition';
import {
  handleBeginPetDrag,
  handleReleasePetDrag,
  handleSetMenuExpanded,
} from '../../src/main/shimeji-ipc-handlers';
import {
  registerAutonomyIpcHandlers,
  type RegisteredAutonomyIpcHandler,
} from '../../src/main/autonomy-ipc-registration';
import { toPetPresentationStateDTO } from '../../src/main/mappers/shimeji-ipc.mapper';
import { requestCharacterSleepWake } from '../../src/renderer/pet-main-bridge';
import type { PetPresentationStateDTO, WispApiBridge } from '../../src/shared/ipc-contracts';

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electronMocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}));

import '../../src/preload/index';

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
  public clearTimeout(handle: unknown): void { this.tasks.delete(handle as number); }
  public take(): (() => void) | undefined {
    const entry = this.tasks.entries().next().value as
      | [number, { readonly dueAtMs: number; readonly callback: () => void }]
      | undefined;
    if (entry === undefined) return undefined;
    this.tasks.delete(entry[0]);
    this.nowMs = entry[1].dueAtMs;
    return entry[1].callback;
  }
  public peek(): (() => void) | undefined {
    return this.tasks.values().next().value?.callback;
  }
  public advanceBy(deltaMs: number): void {
    const targetMs = this.nowMs + deltaMs;
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.dueAtMs <= targetMs)
        .sort((left, right) => left[1].dueAtMs - right[1].dueAtMs)[0];
      if (next === undefined) break;
      this.tasks.delete(next[0]);
      this.nowMs = next[1].dueAtMs;
      next[1].callback();
    }
    this.nowMs = targetMs;
  }
  public size(): number { return this.tasks.size; }
}

function sequence(...values: number[]): IPrng {
  let index = 0;
  return { next: () => values[index++] ?? 0 };
}

function createFixture(
  random: IPrng = sequence(0, 0.4, 0.9, 0.5, 0),
  publishPresentation?: (state: PetPresentationStateDTO) => void
) {
  const scheduler = new Scheduler();
  const commitRootPosition = vi.fn();
  const environment = {
    capturedAtMs: 0,
    screenBounds: { id: 'secondary', x: -500, y: 20, width: 900, height: 700 },
    currentSurface: {
      id: 'floor', kind: 'screen_floor' as const,
      bounds: { x: -500, y: 20, width: 900, height: 700 },
      supportY: 710, isValidSupport: true,
    },
  };
  const motionEvents: MotionEvent[] = [];
  let composition: MainAutonomyComposition;
  const orchestrator = new ShimejiMotionOrchestrator({
    initialMotion: {
      phase: 'grounded', position: { x: -450, y: 710 }, velocityPxPerSec: { x: 0, y: 0 },
      activeBoundsId: 'secondary', airborneElapsedSec: 0, peakGroundImpactSeverity: 0,
    },
    initialSurface: {
      phase: 'grounded', updatedAtMs: 0, locomotionVelocityPxPerSec: { x: 0, y: 0 },
    },
    motionEngine: new MotionEngine(),
    surfaceKinematics: new SurfaceKinematics(),
    environment: () => environment,
    positionPort: { commitRootPosition },
    now: () => scheduler.nowMs,
    eventDispatcher: {
      dispatchMotionEvent: (event) => {
        motionEvents.push(event);
        composition.handleMotionEvent(event);
      },
      dispatchSurfaceEvent: (event) => {
        if (event.type === 'support_lost') composition.handleSupportLost();
      },
    },
    onVoluntaryMovementCompleted: () => composition.notifyVoluntaryMovementCompleted(),
  });
  orchestrator.start();
  const requestedWander = vi.fn((command: {
    readonly kind: 'horizontal_wander';
    readonly targetRootPosition: Vector2Dto;
    readonly speedPxPerSec: number;
  }) => orchestrator.requestVoluntaryMovement(command));
  let presentationRevision = 0;
  let animationRequestSequence = 0;
  const onPresentationChanged = vi.fn(() => {
    publishPresentation?.(toPetPresentationStateDTO({
      revision: ++presentationRevision,
      motion: orchestrator.getMotionState(),
      animationState: composition.getAnimationState(),
      ...(composition.getAnimationRequestId() === undefined
        ? {}
        : { animationRequestId: composition.getAnimationRequestId() }),
    }));
  });
  composition = new MainAutonomyComposition({
    clock: { now: () => scheduler.nowMs }, scheduler,
    prng: random,
    prngMetadata: { algorithm: 'sequence', seed: 1 },
    getCharacterSnapshot: () => ({
      needs: { energy: 70, attention: 20, play: 20, comfort: 20, boredom: 20 },
      synthesizedTone: 'neutral',
    }),
    movement: {
      getRootPosition: () => orchestrator.getMotionState().position,
      getBounds: () => environment.screenBounds,
      getCollisionInsets: () => ({ left: 50, right: 50, top: 90, bottom: 10 }),
      canAcceptVoluntaryMovement: () => orchestrator.canAcceptVoluntaryMovement(),
      requestVoluntaryMovement: requestedWander,
      cancelVoluntaryMovement: () => orchestrator.cancelVoluntaryMovement(),
    },
    requestManualRootPosition: (targetRootPosition) => {
      return orchestrator.requestVoluntaryMovement({ kind: 'manual_root', targetRootPosition });
    },
    createAnimationRequestId: () => `animation-${++animationRequestSequence}`,
    onPresentationChanged,
    behaviorConfig: {
      minIdleDurationMs: 10, maxIdleDurationMs: 10,
      minWanderDurationMs: 20, maxWanderDurationMs: 1000,
      wanderSpeedPxPerSec: 100, napProbability: 0.15, maxWanderDistancePx: 100,
    },
  });
  return {
    scheduler,
    environment,
    orchestrator,
    composition,
    requestedWander,
    commitRootPosition,
    onPresentationChanged,
    motionEvents,
  };
}

function exposedApi(): WispApiBridge {
  const call = electronMocks.exposeInMainWorld.mock.calls[0];
  if (call === undefined) throw new Error('Preload bridge was not exposed');
  return call[1] as WispApiBridge;
}

function registerFixtureHandlers(fixture: ReturnType<typeof createFixture>) {
  const handlers = new Map<string, RegisteredAutonomyIpcHandler>();
  const trustedSender = {};
  registerAutonomyIpcHandlers({
    register: (channel, handler) => handlers.set(channel, handler),
    getWindow: () => ({
      webContents: trustedSender,
      isDestroyed: () => false,
      setResizable: vi.fn(),
      setSize: vi.fn(),
    }),
    getController: () => fixture.composition,
    getNativePosition: () => {
      const root = fixture.orchestrator.getMotionState().position;
      return { x: root.x - 50, y: root.y - 90 };
    },
    getScreenBounds: () => fixture.environment.screenBounds,
    pivotOffset: { x: 50, y: 90 },
    compactSize: { width: 280, height: 320 },
    expandedSize: { width: 1_140, height: 620 },
  });
  const invoke = async (channel: string, payload: unknown): Promise<unknown> => {
    const handler = handlers.get(channel);
    if (handler === undefined) throw new Error(`Missing handler: ${channel}`);
    return handler({ sender: trustedSender }, payload);
  };
  return { invoke };
}

describe('Main integration: AUTO-I01 composition boundary', () => {
  it('wires one coordinator through parity, root-edge, menu pause, and late cleanup', () => {
    const fixture = createFixture();
    fixture.composition.start();
    fixture.scheduler.take()?.();

    expect(fixture.requestedWander).toHaveBeenCalledWith({
      kind: 'horizontal_wander',
      targetRootPosition: expect.objectContaining({ x: expect.any(Number), y: 710 }),
      speedPxPerSec: 100,
    });
    expect(fixture.requestedWander.mock.calls[0]![0].targetRootPosition.x).toBeGreaterThan(-450);
    expect(fixture.composition.getDecisionTrace()[0]!.orderedCandidateKinds)
      .toEqual(['idle', 'wander', 'sleep']);

    handleSetMenuExpanded(fixture.composition, true);
    expect(fixture.scheduler.size()).toBe(0);
    handleSetMenuExpanded(fixture.composition, false);
    const lateAfterClose = fixture.scheduler.peek();
    expect(fixture.scheduler.size()).toBe(1);
    fixture.composition.stop();
    lateAfterClose?.();
    expect(fixture.scheduler.size()).toBe(0);
    expect(fixture.requestedWander).toHaveBeenCalledOnce();
  });

  it('applies both coordinates of manual reset through the shared Motion transaction', () => {
    const fixture = createFixture();
    fixture.composition.start();

    expect(fixture.composition.requestManualRootPosition({ x: 100, y: 300 })).toBe(true);
    expect(fixture.orchestrator.getMotionState().position).toEqual({ x: -450, y: 710 });
    fixture.scheduler.nowMs = 10;
    fixture.orchestrator.tick();
    fixture.scheduler.nowMs = 20;
    fixture.orchestrator.tick();

    expect(fixture.orchestrator.getMotionState().position).toEqual({ x: 100, y: 300 });
    expect(fixture.commitRootPosition).toHaveBeenCalledWith({
      rootPosition: { x: 100, y: 300 },
      bounds: fixture.environment.screenBounds,
    });
  });

  it('leaves the final voluntary snapshot to the shared motion-loop publisher', () => {
    const fixture = createFixture();
    fixture.composition.start();
    fixture.onPresentationChanged.mockClear();
    expect(fixture.composition.requestManualRootPosition({ x: 100, y: 300 })).toBe(true);

    fixture.scheduler.nowMs = 10;
    expect(fixture.orchestrator.tick()).toBe(true);

    expect(fixture.commitRootPosition).toHaveBeenCalledOnce();
    expect(fixture.composition.getAnimationState()).toBe('idle');
    expect(fixture.onPresentationChanged).not.toHaveBeenCalled();
  });

  it('routes sleep_start -> sleep_loop -> wake through correlated Renderer completion', async () => {
    const fsm = new AnimationStateMachine('idle');
    let rendererPresentationHandler:
      | ((event: unknown, state: PetPresentationStateDTO) => void)
      | undefined;
    electronMocks.on.mockImplementation((channel, handler) => {
      if (channel === 'pet:presentation-state') rendererPresentationHandler = handler;
    });
    const fixture = createFixture(undefined, (state) => rendererPresentationHandler?.({}, state));
    const handlers = new Map<string, RegisteredAutonomyIpcHandler>();
    const trustedSender = {};
    registerAutonomyIpcHandlers({
      register: (channel, handler) => handlers.set(channel, handler),
      getWindow: () => ({
        webContents: trustedSender,
        isDestroyed: () => false,
        setResizable: vi.fn(),
        setSize: vi.fn(),
      }),
      getController: () => fixture.composition,
      getNativePosition: () => ({ x: -500, y: 620 }),
      getScreenBounds: () => fixture.environment.screenBounds,
      pivotOffset: { x: 50, y: 90 },
      compactSize: { width: 280, height: 320 },
      expandedSize: { width: 1_140, height: 620 },
    });
    electronMocks.invoke.mockImplementation(async (channel: string, payload: unknown) => {
      const handler = handlers.get(channel);
      if (handler === undefined) throw new Error(`Missing handler: ${channel}`);
      return handler({ sender: trustedSender }, payload);
    });
    const api = exposedApi();
    const unsubscribe = api.onPetPresentationState((state) => {
      if (state.animationState === 'sleep_start') fsm.transition('START_SLEEP');
      if (state.animationState === 'wake_up') fsm.transition('WAKE_UP');
    });
    fixture.composition.start();

    await requestCharacterSleepWake(api, 'sleep');
    expect(fixture.composition.getAnimationState()).toBe('sleep_start');
    expect(fixture.composition.getAnimationRequestId()).toBe('animation-1');
    expect(fixture.onPresentationChanged).toHaveBeenCalledOnce();
    expect(fsm.getCurrentState()).toBe('sleep_start');
    await requestCharacterSleepWake(api, 'sleep');
    expect(fixture.composition.getAnimationState()).toBe('sleep_start');
    expect(fixture.onPresentationChanged).toHaveBeenCalledOnce();
    expect(fsm.completeCurrentState()).toBe(true);
    await api.notifyAnimationLifecycleResult({ requestId: 'animation-1', outcome: 'completed' });
    expect(fsm.getCurrentState()).toBe('sleep_loop');
    expect(fixture.composition.getAnimationState()).toBe('sleep_loop');
    expect(fixture.scheduler.size()).toBe(0);

    await requestCharacterSleepWake(api, 'wake');
    expect(fixture.composition.getAnimationState()).toBe('wake_up');
    expect(fixture.composition.getAnimationRequestId()).toBe('animation-2');
    expect(fixture.onPresentationChanged).toHaveBeenCalledTimes(3);
    expect(fsm.getCurrentState()).toBe('wake_up');
    expect(fixture.scheduler.size()).toBe(1);
    expect(fsm.completeCurrentState()).toBe(true);
    await api.notifyAnimationLifecycleResult({ requestId: 'animation-2', outcome: 'completed' });
    expect(fixture.composition.getAnimationState()).toBe('idle');
    expect(fixture.onPresentationChanged).toHaveBeenCalledTimes(4);
    expect(fixture.scheduler.size()).toBe(1);
    unsubscribe();
  });

  it('keeps idle presentation and zero velocity when a wander root command is rejected', () => {
    const fixture = createFixture(sequence(0, 0.4, 0.1, 0.9));
    fixture.requestedWander.mockReturnValue(false);
    fixture.composition.start();

    fixture.scheduler.advanceBy(10);

    expect(fixture.requestedWander).toHaveBeenCalledOnce();
    expect(fixture.composition.getAnimationState()).toBe('idle');
    expect(fixture.orchestrator.getMotionState().velocityPxPerSec).toEqual({ x: 0, y: 0 });
    expect(fixture.onPresentationChanged).toHaveBeenCalledOnce();
    expect(fixture.composition.getDecisionTrace()[0]?.outcomeReason)
      .toBe('movement_command_rejected');
    expect(fixture.scheduler.size()).toBe(1);
  });

  it('delays click-wake cadence until the matching presentation completes', () => {
    const fixture = createFixture();
    fixture.composition.start();
    expect(fixture.composition.requestSleepWake({ action: 'sleep' })).toBe(true);

    expect(fixture.composition.handleClick()).toBe(true);
    expect(fixture.composition.getAnimationState()).toBe('wake_up');
    expect(fixture.scheduler.size()).toBe(1);

    expect(fixture.composition.handleAnimationLifecycleResult({
      requestId: 'foreign',
      outcome: 'completed',
    })).toBe(false);
    expect(fixture.composition.getAnimationState()).toBe('wake_up');
    expect(fixture.composition.handleAnimationLifecycleResult({
      requestId: 'animation-2',
      outcome: 'completed',
    })).toBe(true);

    expect(fixture.composition.getAnimationState()).toBe('idle');
    expect(fixture.scheduler.size()).toBe(1);
  });

  it('does not create cadence through menu or enable changes while wake is pending', () => {
    const fixture = createFixture();
    fixture.composition.start();
    fixture.composition.requestSleepWake({ action: 'sleep' });
    fixture.composition.handleAnimationLifecycleResult({
      requestId: 'animation-1',
      outcome: 'completed',
    });
    fixture.composition.requestSleepWake({ action: 'wake' });
    expect(fixture.scheduler.size()).toBe(1);

    fixture.composition.setMenuOpen(true);
    fixture.composition.setMenuOpen(false);
    fixture.composition.setEnabled(false);
    fixture.composition.setEnabled(true);
    expect(fixture.scheduler.size()).toBe(1);

    fixture.composition.handleAnimationLifecycleResult({
      requestId: 'animation-2',
      outcome: 'completed',
    });
    expect(fixture.scheduler.size()).toBe(1);
  });

  it('keeps the accepted wake suspension when repeated wake commands are rejected', () => {
    const fixture = createFixture();
    fixture.composition.start();
    expect(fixture.composition.requestSleepWake({ action: 'sleep' })).toBe(true);
    expect(fixture.composition.handleAnimationLifecycleResult({
      requestId: 'animation-1',
      outcome: 'completed',
    })).toBe(true);
    expect(fixture.composition.requestSleepWake({ action: 'wake' })).toBe(true);

    expect(fixture.composition.requestSleepWake({ action: 'wake' })).toBe(false);
    expect(fixture.composition.handleClick()).toBe(false);
    expect(fixture.composition.getAnimationState()).toBe('wake_up');
    expect(fixture.composition.getAnimationRequestId()).toBe('animation-2');
    expect(fixture.scheduler.size()).toBe(1);

    expect(fixture.composition.handleAnimationLifecycleResult({
      requestId: 'animation-2',
      outcome: 'completed',
    })).toBe(true);
    expect(fixture.scheduler.size()).toBe(1);
  });

  it('keeps wake suspension through menu IPC manual reposition and its fixed step', async () => {
    const fixture = createFixture();
    const ipc = registerFixtureHandlers(fixture);
    fixture.composition.start();
    fixture.composition.requestSleepWake({ action: 'sleep' });
    fixture.composition.handleAnimationLifecycleResult({
      requestId: 'animation-1',
      outcome: 'completed',
    });
    fixture.composition.requestSleepWake({ action: 'wake' });

    await ipc.invoke('wisp:set-menu-expanded', true);
    fixture.scheduler.nowMs += 10;
    expect(fixture.orchestrator.tick()).toBe(true);
    await ipc.invoke('wisp:set-menu-expanded', false);

    expect(fixture.composition.getAnimationState()).toBe('wake_up');
    expect(fixture.scheduler.size()).toBe(1);
    expect(fixture.composition.handleAnimationLifecycleResult({
      requestId: 'animation-2',
      outcome: 'completed',
    })).toBe(true);
    expect(fixture.scheduler.size()).toBe(1);
  });

  it('keeps wake suspension when a second menu IPC cancels the pending reposition', async () => {
    const fixture = createFixture();
    const ipc = registerFixtureHandlers(fixture);
    fixture.composition.start();
    fixture.composition.requestSleepWake({ action: 'sleep' });
    fixture.composition.handleAnimationLifecycleResult({
      requestId: 'animation-1',
      outcome: 'completed',
    });
    fixture.composition.requestSleepWake({ action: 'wake' });

    await ipc.invoke('wisp:set-menu-expanded', true);
    await ipc.invoke('wisp:set-menu-expanded', false);

    expect(fixture.composition.getAnimationState()).toBe('wake_up');
    expect(fixture.composition.getAnimationRequestId()).toBe('animation-2');
    expect(fixture.scheduler.size()).toBe(1);
  });

  it('keeps landing suspension through menu IPC manual reposition and its fixed step', async () => {
    const fixture = createFixture();
    const ipc = registerFixtureHandlers(fixture);
    fixture.composition.start();
    fixture.composition.handleMotionEvent({
      type: 'airborne_started',
      cause: 'throw_release',
      atMs: 1,
    });
    fixture.composition.handleMotionEvent({
      type: 'landed',
      outcome: 'soft_landing',
      impactSeverity: 0,
    });
    const landingRequestId = fixture.composition.getAnimationRequestId();
    if (landingRequestId === undefined) throw new Error('Missing landing request ID');

    await ipc.invoke('wisp:set-menu-expanded', true);
    fixture.scheduler.nowMs += 10;
    expect(fixture.orchestrator.tick()).toBe(true);
    await ipc.invoke('wisp:set-menu-expanded', false);

    expect(fixture.composition.getAnimationState()).toBe('land');
    expect(fixture.composition.getAnimationRequestId()).toBe(landingRequestId);
    expect(fixture.scheduler.size()).toBe(1);
    expect(fixture.composition.handleAnimationLifecycleResult({
      requestId: landingRequestId,
      outcome: 'completed',
    })).toBe(true);
    expect(fixture.composition.getAnimationState()).toBe('settle');
    expect(fixture.scheduler.size()).toBe(1);
  });

  it('keeps replacement correlation and does not resume from interrupted or duplicate results', () => {
    const fixture = createFixture();
    fixture.composition.start();
    expect(fixture.composition.requestSleepWake({ action: 'sleep' })).toBe(true);
    expect(fixture.composition.getAnimationRequestId()).toBe('animation-1');

    expect(fixture.composition.requestSleepWake({ action: 'wake' })).toBe(true);
    expect(fixture.composition.getAnimationRequestId()).toBe('animation-2');
    expect(fixture.composition.handleAnimationLifecycleResult({
      requestId: 'animation-1',
      outcome: 'completed',
    })).toBe(false);
    expect(fixture.composition.handleAnimationLifecycleResult({
      requestId: 'animation-2',
      outcome: 'interrupted',
    })).toBe(true);
    expect(fixture.composition.handleAnimationLifecycleResult({
      requestId: 'animation-2',
      outcome: 'interrupted',
    })).toBe(false);
    expect(fixture.composition.getAnimationState()).toBe('wake_up');
    expect(fixture.scheduler.size()).toBe(0);
  });

  it('recovers a rejected wake through fresh cadence gates', () => {
    const fixture = createFixture();
    fixture.composition.start();
    fixture.composition.requestSleepWake({ action: 'sleep' });
    fixture.composition.requestSleepWake({ action: 'wake' });

    expect(fixture.composition.handleAnimationLifecycleResult({
      requestId: 'animation-2',
      outcome: 'rejected',
    })).toBe(true);

    expect(fixture.composition.getAnimationState()).toBe('idle');
    expect(fixture.scheduler.size()).toBe(1);
  });

  it.each([
    ['beginDrag', (composition: MainAutonomyComposition) => composition.beginDrag()],
    [
      'drag_started',
      (composition: MainAutonomyComposition) => composition.handleMotionEvent({
        type: 'drag_started',
        atMs: 1,
      }),
    ],
    [
      'airborne_started',
      (composition: MainAutonomyComposition) => composition.handleMotionEvent({
        type: 'airborne_started',
        cause: 'throw_release',
        atMs: 1,
      }),
    ],
    ['support_lost', (composition: MainAutonomyComposition) => composition.handleSupportLost()],
    [
      'suspendForUserInteraction',
      (composition: MainAutonomyComposition) => composition.suspendForUserInteraction(),
    ],
    ['stop', (composition: MainAutonomyComposition) => composition.stop()],
    ['dispose', (composition: MainAutonomyComposition) => composition.dispose()],
  ])('clears an active animation watchdog on %s', (_label, interrupt) => {
    const fixture = createFixture();
    fixture.composition.start();
    fixture.composition.requestSleepWake({ action: 'sleep' });
    fixture.composition.requestSleepWake({ action: 'wake' });
    expect(fixture.scheduler.size()).toBe(1);

    interrupt(fixture.composition);

    expect(fixture.scheduler.size()).toBe(0);
  });

  it('resumes once after Motion landing completes in the real AnimationPlayer and FSM', () => {
    const fixture = createFixture();
    const fsm = new AnimationStateMachine('idle');
    const renderer: ICharacterRenderer = {
      render: () => undefined,
      destroy: () => undefined,
    };
    const player = new AnimationPlayer(renderer);
    const landingClip: ResolvedAnimationClip = {
      key: 'body_land',
      viewport: { width: 512, height: 512 },
      rootPivot: { x: 256, y: 460 },
      transform: { flipX: false, scale: 1 },
      body: {
        id: 'base_body', category: 'body', animationKey: 'body_land',
        zIndex: 10, frames: [{ source: 'land.png', durationMs: 40 }],
      },
    };
    let previousPhase: PetPresentationStateDTO['motionPhase'] = 'grounded';
    let revision = 0;
    let landingRequestId: string | undefined;
    const consumePresentation = (): void => {
      const motion = fixture.orchestrator.getMotionState();
      const state = toPetPresentationStateDTO({
        revision: ++revision,
        motion,
        animationState: motion.phase === 'dragged'
          ? 'dragged'
          : motion.phase === 'airborne'
            ? 'fall'
            : fixture.composition.getAnimationState(),
        ...(fixture.composition.getAnimationRequestId() === undefined
          ? {}
          : { animationRequestId: fixture.composition.getAnimationRequestId() }),
      });
      if (state.motionPhase === 'dragged') fsm.transition('START_DRAG', true, true);
      else if (state.motionPhase === 'airborne') fsm.transition('FALL', true, true);
      else if (state.animationRequestId !== undefined && state.animationState === 'land') {
        landingRequestId = state.animationRequestId;
        expect(fsm.transition('LAND', true, false)).toBe(true);
        player.play(landingClip, { type: 'none' });
      }
      previousPhase = state.motionPhase;
    };
    player.onCompleted(() => {
      expect(fsm.completeCurrentState()).toBe(true);
      if (landingRequestId === undefined) throw new Error('Missing landing request ID');
      fixture.composition.handleAnimationLifecycleResult({
        requestId: landingRequestId,
        outcome: 'completed',
      });
    });
    fixture.composition.start();
    const begin = handleBeginPetDrag(fixture.orchestrator, {
      pointerId: 1,
      sequence: 0,
      screenPosition: { x: -450, y: 710 },
    });
    fixture.composition.beginDrag();
    fixture.scheduler.nowMs = 10;
    if (fixture.orchestrator.tick()) consumePresentation();
    handleReleasePetDrag(fixture.orchestrator, {
      ...begin,
      pointerId: 1,
      sequence: 1,
      screenPosition: { x: -450, y: 710 },
    });

    expect(fixture.scheduler.size()).toBe(0);
    for (let step = 0; step < 600 && landingRequestId === undefined; step += 1) {
      fixture.scheduler.nowMs += 10;
      if (fixture.orchestrator.tick()) consumePresentation();
    }
    fixture.composition.setMenuOpen(true);
    fixture.composition.setMenuOpen(false);
    fixture.composition.setEnabled(false);
    fixture.composition.setEnabled(true);
    expect(fixture.scheduler.size()).toBe(1);
    player.tick(40);

    expect(previousPhase).toBe('grounded');
    expect(fixture.motionEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining(['drag_started', 'airborne_started', 'landed'])
    );
    expect(fsm.getCurrentState()).toBe('settle');
    expect(fixture.composition.getAnimationState()).toBe('settle');
    expect(fixture.composition.handleAnimationLifecycleResult({
      requestId: landingRequestId ?? 'missing',
      outcome: 'completed',
    })).toBe(false);
    expect(fixture.scheduler.size()).toBe(1);
  });

  it('uses a bounded watchdog only for recovery and invalidates late lifecycle results', () => {
    const fixture = createFixture();
    fixture.composition.start();
    fixture.composition.requestSleepWake({ action: 'sleep' });
    const requestId = fixture.composition.getAnimationRequestId();
    if (requestId === undefined) throw new Error('Missing animation request ID');

    fixture.scheduler.advanceBy(15_000);

    expect(fixture.composition.getAnimationState()).toBe('sleep_loop');
    expect(fixture.composition.handleAnimationLifecycleResult({
      requestId,
      outcome: 'completed',
    })).toBe(false);
    expect(fixture.scheduler.size()).toBe(0);
  });
});
