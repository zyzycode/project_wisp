import { describe, expect, it, vi } from 'vitest';
import type { PetMainBridge } from '../../src/renderer/pet-main-bridge';
import {
  beginPetDrag,
  movePetDrag,
  PetDragController,
  PetPresentationRevisionGate,
  releasePetDrag,
  subscribeToPetPresentation,
} from '../../src/renderer/pet-main-bridge';

describe('Renderer: Pet Main bridge', () => {
  it('forwards typed drag payloads and unsubscribes the presentation listener', async () => {
    const unsubscribe = vi.fn();
    const bridge: PetMainBridge = {
      beginPetDrag: vi.fn(async () => ({ dragSessionId: 'drag-1' })),
      movePetDrag: vi.fn(async () => undefined),
      releasePetDrag: vi.fn(async () => undefined),
      onPetPresentationState: vi.fn(() => unsubscribe),
    };
    const begin = { pointerId: 4, sequence: 0, screenPosition: { x: 10, y: 20 } };
    const move = { ...begin, sequence: 1, dragSessionId: 'drag-1' };
    const listener = vi.fn();

    const stop = subscribeToPetPresentation(bridge, listener);
    await beginPetDrag(bridge, begin);
    await movePetDrag(bridge, move);
    await releasePetDrag(bridge, move);
    stop();

    expect(bridge.onPetPresentationState).toHaveBeenCalledWith(listener);
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
      onPetPresentationState: vi.fn(() => () => undefined),
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

  it('accepts only increasing presentation revisions', () => {
    const gate = new PetPresentationRevisionGate();
    const state = {
      revision: 2, motionPhase: 'grounded' as const, rootScreenPosition: { x: 1, y: 2 },
      velocityPxPerSec: { x: 0, y: 0 }, positionAuthority: 'voluntary' as const,
      animationState: 'idle' as const,
    };

    expect(gate.accept(state)).toBe(true);
    expect(gate.accept(state)).toBe(false);
    expect(gate.accept({ ...state, revision: 3 })).toBe(true);
  });
});
