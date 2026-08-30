import { describe, expect, it, vi } from 'vitest';
import type { WispApiBridge } from '../../src/shared/ipc-contracts';

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
  it('uses typed pet IPC channels and removes the exact presentation listener', async () => {
    const api = exposedApi();
    const begin = { pointerId: 1, sequence: 0, screenPosition: { x: 10, y: 20 } };
    const move = { ...begin, sequence: 1, dragSessionId: 'session-1' };
    const listener = vi.fn();

    const unsubscribe = api.onPetPresentationState(listener);
    await api.beginPetDrag(begin);
    await api.movePetDrag(move);
    await api.releasePetDrag(move);
    unsubscribe();

    expect(electronMocks.invoke).toHaveBeenNthCalledWith(1, 'pet:begin-drag', begin);
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(2, 'pet:move-drag', move);
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(3, 'pet:release-drag', move);
    expect(electronMocks.on).toHaveBeenCalledWith('pet:presentation-state', expect.any(Function));
    const registeredListener = electronMocks.on.mock.calls.find(
      ([channel]: readonly unknown[]) => channel === 'pet:presentation-state'
    )?.[1];
    expect(electronMocks.removeListener).toHaveBeenCalledWith('pet:presentation-state', registeredListener);
  });
});
