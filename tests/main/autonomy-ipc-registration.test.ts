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
    handleAnimationLifecycleResult: vi.fn(),
    requestManualRootPosition: vi.fn(() => true),
  };

  registerAutonomyIpcHandlers({
    register: (channel, handler) => handlers.set(channel, handler),
    getWindow: () => window,
    getController: () => controller,
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
  return { handler, trustedSender, window, controller };
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
    await expect(fixture.handler('wisp:animation-lifecycle-result')(
      foreignEvent,
      { requestId: 'animation-1', outcome: 'completed' }
    )).rejects.toThrow('Untrusted');

    expect(fixture.controller.setMenuOpen).not.toHaveBeenCalled();
    expect(fixture.controller.setEnabled).not.toHaveBeenCalled();
    expect(fixture.controller.requestSleepWake).not.toHaveBeenCalled();
    expect(fixture.controller.handleAnimationLifecycleResult).not.toHaveBeenCalled();
    expect(fixture.controller.requestManualRootPosition).not.toHaveBeenCalled();
    expect(fixture.window.setSize).not.toHaveBeenCalled();
  });

  it('routes a validated lifecycle result and treats malformed payload as a boundary error', async () => {
    const fixture = createRegistrationFixture();
    const event = { sender: fixture.trustedSender };

    await expect(fixture.handler('wisp:animation-lifecycle-result')(
      event,
      { requestId: 'animation-1', outcome: 'interrupted' }
    )).resolves.toBeUndefined();
    expect(fixture.controller.handleAnimationLifecycleResult).toHaveBeenCalledWith({
      requestId: 'animation-1',
      outcome: 'interrupted',
    });

    await expect(fixture.handler('wisp:animation-lifecycle-result')(
      event,
      { requestId: 'animation-1', outcome: 'completed', extra: true }
    )).rejects.toThrow(TypeError);
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
