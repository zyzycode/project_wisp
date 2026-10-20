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
    autonomy: { quiet: false }, cursorGame: null,
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
      episodeId, episodeSequence: Number(episodeId.split('-').at(-1)), episodeStartedAtMs: 10, kind: 'idle_blink', category: 'idle',
      priority: 'low', interrupt: 'yes', loop: 'until_replaced', emotionalTone: 'neutral',
    },
  };
}

describe('Renderer: Pet Main bridge', () => {
  it('rejects old sequences, mutation and current-ID replay, then resets only with the subscription', () => {
    const gate = new BrainStateRevisionGate(() => {});
    expect(gate.accept(brainState(1, 'episode-40'))).not.toBeNull();
    expect(gate.accept(brainState(2, 'episode-39'))).toBeNull();
    const replay = brainState(3, 'episode-40');
    expect(gate.accept({ ...replay, visualIntent: { ...replay.visualIntent, episodeSequence: 41 } })).toBeNull();
    expect(gate.accept(brainState(4, 'episode-41'))).not.toBeNull();
    expect(gate.accept({ ...brainState(5, 'episode-41'), streamId: 'foreign' })).toBeNull();
    gate.reset();
    expect(gate.accept({ ...brainState(1), streamId: 'foreign' })).not.toBeNull();
  });
  it('retains constant episode bookkeeping across 25000 visual episodes', () => {
    const gate = new BrainStateRevisionGate(() => {});
    for (let index = 1; index <= 25000; index++) {
      expect(gate.accept(brainState(index, `episode-${index}`))).not.toBeNull();
    }
    const retained = Object.values(gate).filter(value => value instanceof Map || value instanceof Set)
      .reduce((sum, value) => sum + value.size, 0);
    expect(retained).toBeLessThanOrEqual(1);
  });
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

describe('external window capability projection', () => {
  it.each(['available', 'initializing', 'unavailable', 'unsupported'] as const)('retains %s through the shared validator', status => {
    const gate = new BrainStateRevisionGate(() => {});
    expect(gate.accept({ ...brainState(), externalWindowSupport: status })?.externalWindowSupport).toBe(status);
  });
  it('keeps absent capability unknown and rejects arbitrary metadata', () => {
    expect(new BrainStateRevisionGate(() => {}).accept(brainState())?.externalWindowSupport).toBeUndefined();
    expect(new BrainStateRevisionGate(() => {}).accept({ ...brainState(), externalWindowSupport: { pid: 12 } })).toBeNull();
  });
});
