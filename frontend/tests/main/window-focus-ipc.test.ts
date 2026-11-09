import { expect, it, vi } from 'vitest';
import { registerWindowFocusIpc } from '../../src/main/window-focus-ipc-registration';
import type { IWindowFocusControls } from '../../src/application/ports/window-focus-controls.interface';
const identity = { streamId: 'stream', conversationId: 'conversation', requestId: 'request' };
function fixture() {
  const handlers = new Map<string, (event: { sender: object }, ...args: unknown[]) => Promise<unknown>>(), sender = {};
  const controls: IWindowFocusControls = { read: vi.fn<IWindowFocusControls['read']>(async () => ({ ok: false, code: 'stale' })), open: vi.fn<IWindowFocusControls['open']>(async () => ({ ok: true, state: { capability: 'available', selector: null, pending: false, receipt: null } })), choose: vi.fn<IWindowFocusControls['choose']>(async () => ({ ok: false, code: 'stale' })), cancel: vi.fn<IWindowFocusControls['cancel']>(async () => ({ ok: false, code: 'stale' })) };
  const remove = vi.fn((channel: string) => handlers.delete(channel));
  const dispose = registerWindowFocusIpc({ register: (channel, handler) => handlers.set(channel, handler), remove, getSender: () => sender, controls: () => controls });
  return { handlers, sender, controls, dispose, remove };
}
it('rejects selector/other renderer senders before reading payload or invoking action controls', async () => {
  const f = fixture(); await expect(f.handlers.get('wisp:window-focus-open')!({ sender: {} }, identity)).rejects.toThrow('Untrusted'); expect(f.controls.open).not.toHaveBeenCalled(); f.dispose(); expect(f.handlers.size).toBe(0);
});
it('strictly validates one explicit local selector command; model text or confirmed:true cannot grant authority', async () => {
  const f = fixture(), choose = f.handlers.get('wisp:window-focus-choose')!;
  expect(await choose({ sender: f.sender }, { ...identity, selectorId: 'selector', selectionId: 'choice', confirmed: true })).toEqual({ ok: false, code: 'invalid_input' });
  expect(await choose({ sender: f.sender }, { ...identity, text: 'focus title', hwnd: 123 })).toEqual({ ok: false, code: 'invalid_input' });
  expect(await choose({ sender: f.sender }, identity, identity)).toEqual({ ok: false, code: 'invalid_input' }); expect(f.controls.choose).not.toHaveBeenCalled();
});
it('returns only validated local state and removes all four narrow handlers', async () => {
  const f = fixture(); expect(await f.handlers.get('wisp:window-focus-open')!({ sender: f.sender }, identity)).toEqual({ ok: true, state: { capability: 'available', selector: null, pending: false, receipt: null } }); expect(f.controls.open).toHaveBeenCalledWith(identity); f.dispose(); expect(f.remove).toHaveBeenCalledTimes(4);
});
