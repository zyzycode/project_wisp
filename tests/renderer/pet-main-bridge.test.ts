import { describe, expect, it, vi } from 'vitest';
import type { PetMainBridge } from '../../src/renderer/pet-main-bridge';
import {
  BrainStateRevisionGate,
  postBodyEvent,
  subscribeToBrainState,
} from '../../src/renderer/pet-main-bridge';
import type { BrainStateDTO } from '../../src/shared/ipc-contracts';

function brainState(revision = 1, episodeId = 'episode-1'): BrainStateDTO {
  return {
    dialogue: { conversationId: 'conversation-1', canSubmit: true, turn: { phase: 'idle' } },
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
  it('forwards the typed Body stream and unsubscribes the Brain listener', async () => {
    const unsubscribe = vi.fn();
    const bridge: PetMainBridge = {
      postBodyEvent: vi.fn(async () => undefined),
      onBrainState: vi.fn(() => unsubscribe),
    };
    const event = {
      streamId: 'stream-1', sequence: 1, basedOnRevision: 1, observedAtMs: 30,
      type: 'drag_started' as const, gestureId: 'gesture-1', pointerId: 4,
      screenPosition: { x: 10, y: 20 },
    };
    const listener = vi.fn();

    const stop = subscribeToBrainState(bridge, listener);
    await postBodyEvent(bridge, event);
    stop();

    expect(bridge.onBrainState).toHaveBeenCalledWith(listener);
    expect(bridge.postBodyEvent).toHaveBeenCalledWith(event);
    expect(unsubscribe).toHaveBeenCalledOnce();
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
