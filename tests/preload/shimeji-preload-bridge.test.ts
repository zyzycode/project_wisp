import { describe, expect, it, vi } from 'vitest';
import type { BrainStateDTO, WispApiBridge } from '../../src/shared/ipc-contracts';

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

function exposedApi(): WispApiBridge {
  const call = electronMocks.exposeInMainWorld.mock.calls[0];
  if (call === undefined) throw new Error('Preload bridge was not exposed');
  return call[1] as WispApiBridge;
}

describe('Preload: Shimeji bridge', () => {
  it('uses exact Brain/Body channels, validates snapshots, and removes the exact listener', async () => {
    const api = exposedApi();
    const begin = { pointerId: 1, sequence: 0, screenPosition: { x: 10, y: 20 } };
    const move = { ...begin, sequence: 1, dragSessionId: 'session-1' };
    const listener = vi.fn();

    const unsubscribe = api.onBrainState(listener);
    await api.beginPetDrag(begin);
    await api.movePetDrag(move);
    await api.releasePetDrag(move);
    await api.setAutonomyEnabled?.({ enabled: false });
    await api.requestSleepWake({ action: 'sleep' });
    await api.requestSleepWake({ action: 'wake' });
    const bodyEvent = {
      streamId: 'stream-1', sequence: 1, basedOnRevision: 1, observedAtMs: 20,
      type: 'interaction' as const, interaction: 'click' as const,
    };
    await api.postBodyEvent(bodyEvent);

    const brainState: BrainStateDTO = {
      streamId: 'stream-1', revision: 1, sampledAtMs: 10,
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
        episodeId: 'episode-1', episodeStartedAtMs: 5, kind: 'idle_blink',
        category: 'idle', priority: 'low', interrupt: 'yes', loop: 'until_replaced',
        emotionalTone: 'neutral',
      },
    };
    const registeredListener = electronMocks.on.mock.calls.find(
      ([channel]: readonly unknown[]) => channel === 'wisp:brain-state'
    )?.[1] as ((event: unknown, payload: unknown) => void) | undefined;
    registeredListener?.({}, brainState);
    registeredListener?.({}, { ...brainState, extra: true });
    unsubscribe();
    registeredListener?.({}, { ...brainState, revision: 2 });
    const lateListener = vi.fn();
    const unsubscribeLate = api.onBrainState(lateListener);
    unsubscribeLate();

    expect(electronMocks.invoke).toHaveBeenNthCalledWith(1, 'pet:begin-drag', begin);
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(2, 'pet:move-drag', move);
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(3, 'pet:release-drag', move);
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(4, 'wisp:set-autonomy-enabled', { enabled: false });
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(5, 'wisp:request-sleep-wake', { action: 'sleep' });
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(6, 'wisp:request-sleep-wake', { action: 'wake' });
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(
      7,
      'wisp:body-event',
      bodyEvent
    );
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(brainState);
    expect(lateListener).toHaveBeenCalledWith({ ...brainState, revision: 2 });
    expect(electronMocks.on).toHaveBeenCalledWith('wisp:brain-state', registeredListener);
  });
});
