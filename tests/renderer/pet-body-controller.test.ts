import { describe, expect, it, vi } from 'vitest';
import { PetBodyController } from '../../src/renderer/pet-body-controller';
import type { PetMainBridge } from '../../src/renderer/pet-main-bridge';
import type { BrainStateDTO } from '../../src/shared/ipc-contracts';

function brainState(revision: number, episodeId = 'episode-1'): BrainStateDTO {
  return {
    streamId: 'stream-1',
    revision,
    sampledAtMs: 20 + revision,
    character: {
      needs: { energy: 80, attention: 30, play: 40, comfort: 50, boredom: 10 },
      synthesizedTone: 'neutral',
    },
    activity: null,
    motion: {
      phase: 'grounded',
      rootScreenPosition: { x: 100, y: 200 },
      velocityPxPerSec: { x: 10, y: 0 },
      positionAuthority: 'voluntary',
    },
    visualIntent: {
      episodeId,
      episodeStartedAtMs: 10,
      kind: 'walk',
      category: 'movement',
      priority: 'normal',
      interrupt: 'yes',
      loop: 'until_replaced',
      emotionalTone: 'neutral',
    },
  };
}

function fixture() {
  const bridge: PetMainBridge = {
    onBrainState: vi.fn(() => () => undefined),
    postBodyEvent: vi.fn(async () => undefined),
  };
  const diagnostic = vi.fn();
  const controller = new PetBodyController(bridge, () => 50, diagnostic);
  return { bridge, controller, diagnostic };
}

describe('Renderer: Pet Body controller', () => {
  it('atomically accepts only ordered Brain snapshots and keeps reflex updates renderer-local', () => {
    const { bridge, controller, diagnostic } = fixture();

    expect(controller.postInteraction('click')).toBe(false);
    expect(controller.acceptBrainState(brainState(1))?.visual).toMatchObject({
      streamId: 'stream-1',
      revision: 1,
      visualAgeMs: 11,
      reflex: { transform: { flipX: true } },
    });
    expect(controller.acceptBrainState(brainState(1))).toBeNull();
    expect(controller.acceptBrainState(brainState(2))?.visual.revision).toBe(2);

    controller.setPupilOffset({ x: 4, y: -4 });
    controller.setDragReflex({ scaleX: 1.08, scaleY: 0.92, rotationDeg: 12 });

    expect(controller.getSnapshot()?.visual).toMatchObject({
      revision: 4,
      reflex: {
        pupilOffset: { x: 1, y: -1 },
        transform: { scaleX: 1.08, scaleY: 0.92, rotationDeg: 12 },
      },
    });
    expect(bridge.postBodyEvent).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith('Rejected stale or foreign Brain snapshot');
  });

  it('assigns shared sequence at send time and emits one causal terminal drag event', () => {
    const { bridge, controller } = fixture();
    controller.acceptBrainState(brainState(3));

    expect(controller.postInteraction('pet', 0.5)).toBe(true);
    expect(controller.postMenuVisibility(true)).toBe(true);
    const gestureId = controller.beginDrag(7, { x: 10, y: 20 });
    expect(gestureId).toBe('gesture-1');
    expect(controller.moveDrag(gestureId!, 7, { x: 20, y: 30 })).toBe(true);
    expect(controller.endDrag(gestureId!, 7, { x: 25, y: 35 }, false)).toBe(true);
    expect(controller.endDrag(gestureId!, 7, { x: 25, y: 35 }, false)).toBe(false);

    expect(bridge.postBodyEvent).toHaveBeenCalledTimes(5);
    expect(vi.mocked(bridge.postBodyEvent).mock.calls.map(([event]) => event.sequence))
      .toEqual([1, 2, 3, 4, 5]);
    expect(vi.mocked(bridge.postBodyEvent).mock.calls.map(([event]) => event.basedOnRevision))
      .toEqual([3, 3, 3, 3, 3]);
    expect(vi.mocked(bridge.postBodyEvent).mock.calls[4]?.[0]).toMatchObject({
      type: 'drag_ended', gestureId: 'gesture-1', pointerId: 7, cancelled: false,
    });
  });

  it('resets ordering only when a new subscription lifecycle starts', () => {
    const listeners: Array<(state: BrainStateDTO) => void> = [];
    const unsubscribe = vi.fn();
    const bridge: PetMainBridge = {
      onBrainState: vi.fn((listener) => {
        listeners.push(listener);
        return unsubscribe;
      }),
      postBodyEvent: vi.fn(async () => undefined),
    };
    const controller = new PetBodyController(bridge, () => 1, () => undefined);
    const first = vi.fn();
    const stop = controller.subscribe(first);
    listeners[0]?.(brainState(1));
    stop();

    const second = vi.fn();
    controller.subscribe(second);
    listeners[1]?.({ ...brainState(1), streamId: 'stream-2' });

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledWith(expect.objectContaining({
      brain: expect.objectContaining({ streamId: 'stream-2', revision: 1 }),
    }));
  });
});
