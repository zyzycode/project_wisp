import { afterEach, expect, it, vi } from 'vitest';
import type { WispApiBridge } from '../../src/shared/ipc-contracts';
const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), on: vi.fn(), remove: vi.fn() }));
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: { invoke: mocks.invoke, on: mocks.on, removeListener: mocks.remove } }));
const original = [...process.argv], identity = { streamId: 'stream', conversationId: 'conversation', requestId: 'request' };
afterEach(() => { process.argv = [...original]; vi.resetModules(); mocks.expose.mockClear(); mocks.invoke.mockReset(); });
it('validates exact local focus command/result at preload; native confirmation cannot be asserted by Renderer', async () => {
  await import('../../src/preload/index'); const bridge = (mocks.expose.mock.calls[0]![1] as WispApiBridge).windowFocus!;
  mocks.invoke.mockResolvedValue({ ok: false, code: 'stale' });
  await bridge.read(identity); await bridge.open(identity); await bridge.cancel(identity); await bridge.choose({ ...identity, selectorId: 'selector', selectionId: 'selection' });
  expect(mocks.invoke.mock.calls.map(call => call[0])).toEqual(['wisp:window-focus-read', 'wisp:window-focus-open', 'wisp:window-focus-cancel', 'wisp:window-focus-choose']);
  const forged = { ...identity, selectorId: 'selector', selectionId: 'selection', confirmed: true };
  await expect(bridge.choose(forged)).rejects.toThrow(); expect(mocks.invoke).toHaveBeenCalledTimes(4);
  mocks.invoke.mockResolvedValue({ ok: true, state: { capability: 'available', selector: null, pending: false, receipt: { attemptId: 'attempt', status: 'success', effect: 'focus_observed', hwnd: 42 } } });
  await expect(bridge.read(identity)).rejects.toThrow();
});
it('does not expose focus or other capabilities to the screen geometry selector', async () => {
  process.argv.push('--wisp-screen-selector'); await import('../../src/preload/index');
  expect(Object.keys(mocks.expose.mock.calls[0]![1])).toEqual(['screenObservation']);
});
