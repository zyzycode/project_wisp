import { describe, expect, it, vi } from 'vitest';
import {
  registerAutonomyIpcHandlers,
  type RegisteredAutonomyIpcHandler,
} from '../../src/main/autonomy-ipc-registration';

function createRegistrationFixture(currentPosition = { x: 1_600, y: 760 }) {
  const handlers = new Map<string, RegisteredAutonomyIpcHandler>();
  const trustedSender = {};
  const window = {
    webContents: trustedSender,
    isDestroyed: () => false,
    setResizable: vi.fn(),
    setSize: vi.fn(),
  };
  const controller = {
    setMenuOpen: vi.fn(),
    setEnabled: vi.fn(),
    requestSleepWake: vi.fn(),
    requestManualRootPosition: vi.fn(() => true),
  };
  const bodyEventIngress = { receive: vi.fn() };

  registerAutonomyIpcHandlers({
    register: (channel, handler) => handlers.set(channel, handler),
    getWindow: () => window,
    getController: () => controller,
    bodyEventIngress,
    getNativePosition: () => currentPosition,
    getScreenBounds: () => ({ id: 'primary', x: 0, y: 0, width: 1_920, height: 1_080 }),
    pivotOffset: { x: 50, y: 90 },
    compactSize: { width: 280, height: 320 },
    expandedSize: { width: 1_140, height: 620 },
  });

  const handler = (channel: string): RegisteredAutonomyIpcHandler => {
    const registered = handlers.get(channel);
    if (registered === undefined) throw new Error(`Missing handler: ${channel}`);
    return registered;
  };
  return { handler, trustedSender, window, controller, bodyEventIngress };
}

describe('Main: autonomy IPC registration', () => {
  it('rejects foreign senders before any menu, autonomy, or sleep/wake mutation', async () => {
    const fixture = createRegistrationFixture();
    const foreignEvent = { sender: {} };

    await expect(fixture.handler('wisp:set-menu-expanded')(foreignEvent, true)).rejects.toThrow(
      'Untrusted'
    );
    await expect(fixture.handler('wisp:set-autonomy-enabled')(
      foreignEvent,
      { enabled: false }
    )).rejects.toThrow('Untrusted');
    await expect(fixture.handler('wisp:request-sleep-wake')(
      foreignEvent,
      { action: 'sleep' }
    )).rejects.toThrow('Untrusted');
    await expect(fixture.handler('wisp:body-event')(
      foreignEvent,
      { type: 'interaction' }
    )).rejects.toThrow('Untrusted');

    expect(fixture.controller.setMenuOpen).not.toHaveBeenCalled();
    expect(fixture.controller.setEnabled).not.toHaveBeenCalled();
    expect(fixture.controller.requestSleepWake).not.toHaveBeenCalled();
    expect(fixture.bodyEventIngress.receive).not.toHaveBeenCalled();
    expect(fixture.controller.requestManualRootPosition).not.toHaveBeenCalled();
    expect(fixture.window.setSize).not.toHaveBeenCalled();
  });

  it('routes Body payloads only through the dedicated ingress boundary', async () => {
    const fixture = createRegistrationFixture();
    const event = { sender: fixture.trustedSender };
    const payload = {
      streamId: 'stream-1', sequence: 1, basedOnRevision: 1, observedAtMs: 10,
      type: 'interaction', interaction: 'click',
    };

    await expect(fixture.handler('wisp:body-event')(event, payload)).resolves.toBeUndefined();
    expect(fixture.bodyEventIngress.receive).toHaveBeenCalledWith(payload);
  });

  it('clamps right and bottom edges by expanded window size through the root command path', async () => {
    const fixture = createRegistrationFixture();

    await expect(fixture.handler('wisp:set-menu-expanded')(
      { sender: fixture.trustedSender },
      true
    )).resolves.toEqual({ x: 780, y: 460 });

    expect(fixture.controller.setMenuOpen).toHaveBeenCalledWith(true);
    expect(fixture.window.setSize).toHaveBeenCalledWith(1_140, 620);
    expect(fixture.controller.requestManualRootPosition).toHaveBeenCalledWith({ x: 830, y: 550 });
  });

  it('preserves a legal left/top position while resizing through the same root path', async () => {
    const fixture = createRegistrationFixture({ x: 0, y: 0 });

    await expect(fixture.handler('wisp:set-menu-expanded')(
      { sender: fixture.trustedSender },
      true
    )).resolves.toEqual({ x: 0, y: 0 });

    expect(fixture.controller.requestManualRootPosition).toHaveBeenCalledWith({ x: 50, y: 90 });
  });

  it('still resizes and keeps the current position when Motion rejects reposition', async () => {
    const currentPosition = { x: 1_600, y: 760 };
    const fixture = createRegistrationFixture(currentPosition);
    fixture.controller.requestManualRootPosition.mockReturnValue(false);

    await expect(fixture.handler('wisp:set-menu-expanded')(
      { sender: fixture.trustedSender },
      true
    )).resolves.toEqual(currentPosition);

    expect(fixture.controller.requestManualRootPosition).toHaveBeenCalledWith({ x: 830, y: 550 });
    expect(fixture.window.setResizable).toHaveBeenCalledWith(true);
    expect(fixture.window.setSize).toHaveBeenCalledWith(1_140, 620);
  });
});
