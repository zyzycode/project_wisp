import { describe, expect, it, vi } from 'vitest';
import type { PetMainBridge } from '../../src/renderer/pet-main-bridge';
import {
  beginPetDrag,
  BrainStateRevisionGate,
  movePetDrag,
  PetDragController,
  releasePetDrag,
  subscribeToBrainState,
} from '../../src/renderer/pet-main-bridge';
import type { BrainStateDTO } from '../../src/shared/ipc-contracts';

function brainState(revision = 1, episodeId = 'episode-1'): BrainStateDTO {
  return {
    streamId: 'stream-1', revision, sampledAtMs: 20,
    character: {
      needs: { energy: 80, attention: 30, play: 40, comfort: 50, boredom: 10 },
      synthesizedTone: 'neutral',
    },
    activity: null,
    motion: {
      phase: 'grounded', rootScreenPosition: { x: 1, y: 2 },
      velocityPxPerSec: { x: 0, y: 0 }, positionAuthority: 'voluntary',
    },
    visualIntent: {
      episodeId, episodeStartedAtMs: 10, kind: 'idle_blink', category: 'idle',
      priority: 'low', interrupt: 'yes', loop: 'until_replaced', emotionalTone: 'neutral',
    },
  };
}

describe('Renderer: Pet Main bridge', () => {
  it('forwards typed drag payloads and unsubscribes the presentation listener', async () => {
    const unsubscribe = vi.fn();
    const bridge: PetMainBridge = {
      beginPetDrag: vi.fn(async () => ({ dragSessionId: 'drag-1' })),
      movePetDrag: vi.fn(async () => undefined),
      releasePetDrag: vi.fn(async () => undefined),
      onBrainState: vi.fn(() => unsubscribe),
    };
    const begin = { pointerId: 4, sequence: 0, screenPosition: { x: 10, y: 20 } };
    const move = { ...begin, sequence: 1, dragSessionId: 'drag-1' };
    const listener = vi.fn();

    const stop = subscribeToBrainState(bridge, listener);
    await beginPetDrag(bridge, begin);
    await movePetDrag(bridge, move);
    await releasePetDrag(bridge, move);
    stop();

    expect(bridge.onBrainState).toHaveBeenCalledWith(listener);
    expect(bridge.beginPetDrag).toHaveBeenCalledWith(begin);
    expect(bridge.movePetDrag).toHaveBeenCalledWith(move);
    expect(bridge.releasePetDrag).toHaveBeenCalledWith(move);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('releases a pending drag session immediately after a late begin response', async () => {
    let resolveBegin: ((result: { readonly dragSessionId: string }) => void) | undefined;
    const bridge: PetMainBridge = {
      beginPetDrag: vi.fn(() => new Promise<{ readonly dragSessionId: string }>((resolve) => { resolveBegin = resolve; })),
      movePetDrag: vi.fn(async () => undefined),
      releasePetDrag: vi.fn(async () => undefined),
      onBrainState: vi.fn(() => () => undefined),
    };
    const controller = new PetDragController(bridge);

    expect(controller.begin(9, { x: 10, y: 20 })).toBe(true);
    expect(controller.move({ x: 15, y: 20 })).toBe(true);
    expect(controller.release({ x: 25, y: 20 })).toBe(true);
    resolveBegin?.({ dragSessionId: 'late-session' });
    await Promise.resolve();
    await Promise.resolve();

    expect(bridge.movePetDrag).toHaveBeenCalledWith({
      dragSessionId: 'late-session', pointerId: 9, sequence: 1, screenPosition: { x: 15, y: 20 },
    });
    expect(bridge.releasePetDrag).toHaveBeenCalledWith({
      dragSessionId: 'late-session', pointerId: 9, sequence: 2, screenPosition: { x: 25, y: 20 },
    });
    expect(controller.move({ x: 30, y: 20 })).toBe(false);
  });

  it('accepts ordered snapshots without replaying one immutable visual episode', () => {
    const diagnostic = vi.fn();
    const gate = new BrainStateRevisionGate(diagnostic);
    const first = brainState(1);

    expect(gate.accept(first)).toEqual(first);
    expect(gate.accept(first)).toBeNull();
    expect(gate.accept(brainState(2))).toEqual(brainState(2));
    expect(gate.accept({
      ...brainState(3),
      visualIntent: { ...brainState(3).visualIntent, kind: 'walk' },
    })).toBeNull();
    expect(gate.accept(brainState(4, 'episode-2'))).toEqual(brainState(4, 'episode-2'));
    expect(gate.accept(brainState(5, 'episode-1'))).toBeNull();
    expect(diagnostic).toHaveBeenCalled();
  });

  it('bounds protocol diagnostics under repeated stale delivery', () => {
    const diagnostic = vi.fn();
    const gate = new BrainStateRevisionGate(diagnostic);
    expect(gate.accept(brainState(1))).not.toBeNull();

    for (let index = 0; index < 20; index += 1) gate.accept(brainState(1));

    expect(diagnostic).toHaveBeenCalledTimes(10);
  });
});
