import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MainWindowFocus } from '../../src/main/main-window-focus';
import type { ExternalWindowFocusPort } from '../../src/application/ports/external-window-focus.port';
const mocks = vi.hoisted(() => ({ confirm: vi.fn(), power: undefined as EventEmitter | undefined }));
vi.mock('electron', async () => { const { EventEmitter } = await import('node:events'); mocks.power = new EventEmitter(); return { dialog: { showMessageBox: mocks.confirm }, powerMonitor: mocks.power }; });
const identity = { streamId: 'stream', conversationId: 'conversation', requestId: 'request' };
function fixture() {
  const port: ExternalWindowFocusPort = { prepare: vi.fn<ExternalWindowFocusPort['prepare']>(async a => ({ status: 'prepared', value: { attemptId: a.attemptId, preparedId: 'nonce' } })), commit: vi.fn<ExternalWindowFocusPort['commit']>(async () => ({ status: 'success', effect: 'focus_observed' })), dispose: vi.fn() };
  const unsubscribe = vi.fn();
  const main = new MainWindowFocus({ windows: { surfaces: { getSnapshot: () => ({ capability: 'available', surfaces: [], capturedAtMs: Date.now(), revision: 1 }), subscribe: vi.fn(() => unsubscribe), dispose: vi.fn() }, focus: port, focusCapability: () => 'available', focusCandidates: policyGeneration => [{ target: { surfaceId: 'opaque', sourceEpoch: 1, policyGeneration, geometrySignature: 'geometry', capturedAtMs: Date.now() }, preview: { left: .1, top: .2, width: .5, height: .4 } }] }, getWindow: () => ({ isDestroyed: () => false }) as BrowserWindow, context: () => ({ ...identity, generation: 1 }), active: () => true, now: Date.now, scheduler: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) } });
  const choose = async () => { const opened = await main.runtime.open(identity); if (!opened.ok || !opened.state.selector) throw Error('Missing selector'); return { ...identity, selectorId: opened.state.selector.selectorId, selectionId: opened.state.selector.candidates[0]!.selectionId }; };
  return { main, port, unsubscribe, choose };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); mocks.confirm.mockReset(); });
afterEach(() => { mocks.power!.removeAllListeners(); vi.useRealTimers(); });
it('native decline never prepares OS action; dialog identifies chosen geometry and defaults to cancel', async () => {
  mocks.confirm.mockResolvedValue({ response: 0 }); const f = fixture(); await f.main.runtime.choose(await f.choose());
  expect(f.port.prepare).not.toHaveBeenCalled(); expect(mocks.confirm.mock.calls[0]![1]).toMatchObject({ defaultId: 0, cancelId: 0, detail: expect.stringContaining('слева 10%') }); f.main.dispose();
});
it('lock invalidates a pending native confirmation; unlock never restores the grant and late consent has no effect', async () => {
  let resolve!: (value: { response: number }) => void; mocks.confirm.mockReturnValue(new Promise(yes => { resolve = yes; }));
  const f = fixture(), work = f.main.runtime.choose(await f.choose()); mocks.power!.emit('lock-screen'); await work; mocks.power!.emit('unlock-screen'); resolve({ response: 1 }); await Promise.resolve();
  expect(f.port.prepare).not.toHaveBeenCalled(); expect(f.port.commit).not.toHaveBeenCalled(); expect(f.main.runtime.state().selector).toBeNull(); f.main.dispose(); f.main.dispose(); expect(f.unsubscribe).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
