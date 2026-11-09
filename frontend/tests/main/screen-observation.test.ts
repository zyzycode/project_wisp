import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const mocks = vi.hoisted(() => ({ windows: [] as object[], dialog: vi.fn(), capture: vi.fn() }));
class Window extends EventEmitter {
  readonly webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() });
  destroyed = false; visible = true;
  constructor(readonly options: unknown = {}) { super(); mocks.windows.push(this); }
  isDestroyed() { return this.destroyed; } isVisible() { return this.visible; }
  hide() { this.visible = false; } showInactive() { this.visible = true; } focus() {}
  close() { this.destroyed = true; this.emit('closed'); }
}
vi.doMock('electron', () => ({ BrowserWindow: Window, dialog: { showMessageBox: mocks.dialog } }));
vi.doMock('../../src/infrastructure/platform/screen-observation-capture', () => ({ ElectronScreenObservationCapture: class {
  availability() { return { status: 'available' }; }
  selectionBounds() { return { x: 0, y: 0, width: 1920, height: 1080 }; }
  capture = mocks.capture;
  dispose() {}
} }));
const { MainScreenObservation } = await import('../../src/main/main-screen-observation');
const identity = { streamId: 's', conversationId: 'c' };
function setup() {
  const main = new Window(), provider = { reserve: vi.fn(() => true), release: vi.fn(), getCapability: vi.fn(async () => ({ status: 'available', provider: 'openai', model: 'gpt-6-astra', policyRevision: 'screen-openai-2026-11' } as const)), observe: vi.fn(async () => ({ visible: ['safe text'], possible: [], unknown: [] })) };
  let current = identity;
  const composition = new MainScreenObservation({ provider, current: () => current, busy: () => false, now: Date.now, getWindow: () => main as never, preloadPath: 'preload.js', loadSelector: vi.fn(async () => undefined) });
  return { composition, main, provider, replace: () => { current = { ...identity, conversationId: 'new' }; } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100); mocks.windows.length = 0; mocks.capture.mockReset(); mocks.dialog.mockReset(); mocks.dialog.mockResolvedValue({ response: 1 }); mocks.capture.mockImplementation(async auth => ({ context: auth.context, previewId: 'p', digest: 'd', preparedAtMs: Date.now(), expiresAtMs: Date.now() + 30000, image: { mimeType: 'image/jpeg', width: 64, height: 64, dataBase64: '/9j/2Q==' } })); });
afterEach(() => vi.useRealTimers());
it('trusts Main only for start/send; selector can only choose a region/cancel and never receives preview', async () => {
  const f = setup(); await expect(f.composition.command({}, { ...identity, type: 'start' })).rejects.toThrow('Untrusted');
  await f.composition.command(f.main.webContents, { ...identity, type: 'start' });
  const selector = mocks.windows[1] as Window;
  expect(selector.options).toMatchObject({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, additionalArguments: ['--wisp-screen-selector'] } });
  await expect(f.composition.command(selector.webContents, { ...identity, type: 'send' })).rejects.toThrow('selector');
  await expect(f.composition.command(f.main.webContents, { ...identity, type: 'region', region: { left: 0, top: 0, width: 1, height: 1 } })).rejects.toThrow('region sender');
  const pending = f.composition.command(selector.webContents, { ...identity, type: 'region', region: { left: 0, top: 0, width: 1, height: 1 } });
  await vi.advanceTimersByTimeAsync(50); expect(await pending).toMatchObject({ phase: 'idle', preview: null });
  expect(f.composition.runtime.read().preview).not.toBeNull(); expect(selector.destroyed).toBe(true); expect(f.main.visible).toBe(true);
  expect(mocks.capture).toHaveBeenCalledOnce(); f.composition.dispose();
});
it('native capture default/cancel has no pixel operation and native send repeats retention disclosure', async () => {
  const f = setup(); await f.composition.command(f.main.webContents, { ...identity, type: 'start' }); const selector = mocks.windows[1] as Window;
  mocks.dialog.mockResolvedValueOnce({ response: 0 }); await f.composition.command(selector.webContents, { ...identity, type: 'region', region: { left: 0, top: 0, width: 1, height: 1 } });
  expect(mocks.capture).not.toHaveBeenCalled(); expect(mocks.dialog.mock.calls[0]![1]).toMatchObject({ defaultId: 0, cancelId: 0 });
  f.composition.dispose();
});
it('profile/conversation replacement rejects stale commands and clears RAM evidence without payload echo', async () => {
  const f = setup(); await f.composition.command(f.main.webContents, { ...identity, type: 'start' }); f.replace();
  await expect(f.composition.command(f.main.webContents, { ...identity, type: 'read' })).rejects.toThrow('Stale');
  expect(f.composition.runtime.read()).toMatchObject({ preview: null, evidence: null, phase: 'idle' }); f.composition.dispose();
});
