import { afterEach, expect, it, vi } from 'vitest';
import type { WispApiBridge } from '../../src/shared/ipc-contracts';
const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), on: vi.fn(), remove: vi.fn() }));
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: { invoke: mocks.invoke, on: mocks.on, removeListener: mocks.remove } }));
const original = [...process.argv];
afterEach(() => { process.argv = [...original]; vi.resetModules(); mocks.expose.mockClear(); mocks.invoke.mockReset(); });
it('validates requests and response shape in preload before crossing the boundary', async () => {
  await import('../../src/preload/index');
  const bridge = mocks.expose.mock.calls[0]![1] as WispApiBridge;
  mocks.invoke.mockResolvedValue({ phase: 'idle', error: null, preview: null, evidence: null });
  expect(await bridge.screenObservation!.command({ type: 'start', streamId: 's', conversationId: 'c' })).toMatchObject({ phase: 'idle' });
  expect(mocks.invoke).toHaveBeenCalledWith('wisp:screen-observation', { type: 'start', streamId: 's', conversationId: 'c' });
  await expect(bridge.screenObservation!.command({ type: 'region', streamId: 's', conversationId: 'c', region: { left: 0, top: 0, width: 2, height: 1 } })).rejects.toThrow();
  expect(mocks.invoke).toHaveBeenCalledOnce();
  mocks.invoke.mockResolvedValue({ phase: 'visible', error: null, preview: null, evidence: { visible: ['ok'], possible: [], unknown: [], command: 'delete' } });
  await expect(bridge.screenObservation!.command({ type: 'read', streamId: 's', conversationId: 'c' })).rejects.toThrow();
});
it('exposes only the typed screen capability in the geometry selector preload', async () => {
  process.argv.push('--wisp-screen-selector'); await import('../../src/preload/index');
  expect(Object.keys(mocks.expose.mock.calls[0]![1])).toEqual(['screenObservation']);
});
