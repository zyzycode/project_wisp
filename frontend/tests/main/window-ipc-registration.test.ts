import { describe, expect, it, vi } from 'vitest';
import { registerWindowIpc } from '../../src/main/window-ipc-registration';

function fixture() {
  const sender = {};
  const handlers = new Map<string, (event: { sender: object }, payload: unknown) => Promise<unknown>>();
  const ignoreMouse = vi.fn();
  const updatePosition = vi.fn(target => target);
  const close = vi.fn();
  const remove = vi.fn();
  const dispose = registerWindowIpc({
    register: (channel, handler) => { handlers.set(channel, handler); }, remove,
    getSender: () => sender, now: () => 10,
    systemInfo: () => ({ platform: 'linux', sessionType: 'x11', appVersion: '1', electronVersion: '1', chromeVersion: '1', nodeVersion: '1' }),
    ignoreMouse, getPosition: () => ({ x: 1, y: 2 }), updatePosition,
    screenBounds: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    environment: () => ({ capturedAtMs: 10, screenBounds: { id: 'screen', x: 0, y: 0, width: 100, height: 100 } }),
    alwaysOnTop: enabled => enabled, close,
  });
  const invoke = (channel: string, payload?: unknown, source = sender) => handlers.get(channel)!({ sender: source }, payload);
  return { invoke, handlers, sender, ignoreMouse, updatePosition, close, dispose, remove };
}

describe('window IPC boundary', () => {
  it('rejects another sender on every registered channel before side effects', async () => {
    const f = fixture();
    for (const channel of f.handlers.keys()) await expect(f.invoke(channel, undefined, {})).rejects.toThrow('Untrusted window sender');
    expect(f.close).not.toHaveBeenCalled();
    expect(f.ignoreMouse).not.toHaveBeenCalled();
  });
  it.each([{ ignore: 'false' }, { ignore: true, forward: 'true' }, { ignore: false, extra: true }, null])('rejects malformed mouse commands %j', async payload => {
    const f = fixture();
    await expect(f.invoke('wisp:set-ignore-mouse-events', payload)).rejects.toThrow();
    expect(f.ignoreMouse).not.toHaveBeenCalled();
  });
  it('preserves valid commands, the default forward flag, and cleanup', async () => {
    const f = fixture();
    await f.invoke('wisp:set-ignore-mouse-events', { ignore: false });
    expect(f.ignoreMouse).toHaveBeenCalledWith({ ignore: false, forward: true });
    await expect(f.invoke('wisp:update-position', { x: 12, y: 24 })).resolves.toEqual({ x: 12, y: 24 });
    await expect(f.invoke('wisp:ping', 'hello')).resolves.toEqual({ reply: 'pong: hello', timestamp: 10 });
    f.dispose();
    expect(f.remove.mock.calls.flat()).toEqual([...f.handlers.keys()]);
  });
  it.each([{ x: Infinity, y: 2 }, { x: 1 }, { x: 1, y: 2, extra: true }])('rejects malformed positions %j', async payload => {
    const f = fixture();
    await expect(f.invoke('wisp:update-position', payload)).rejects.toThrow();
    expect(f.updatePosition).not.toHaveBeenCalled();
  });
});
