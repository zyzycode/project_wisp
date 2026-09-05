import { describe, expect, it, vi } from 'vitest';
import {
  registerAutonomyIpcHandlers,
  type RegisteredAutonomyIpcHandler,
} from '../../src/main/autonomy-ipc-registration';
import type { BodyEventDTO } from '../../src/shared/ipc-contracts';

function bodyEvent(
  type: 'interaction' | 'menu_visibility_changed',
  sequence = 1
): BodyEventDTO {
  const meta = {
    streamId: 'stream-1', sequence, basedOnRevision: 1, observedAtMs: sequence * 10,
  };
  return type === 'interaction'
    ? { ...meta, type, interaction: 'click' }
    : { ...meta, type, expanded: true };
}

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
  const bodyEventIngress = {
    receive: vi.fn((payload: unknown) => payload as BodyEventDTO),
  };
  const handleAcceptedBodyEvent = vi.fn();
  const beginBrainTransaction = vi.fn();
  const commitBrainTransaction = vi.fn();

  registerAutonomyIpcHandlers({
    register: (channel, handler) => handlers.set(channel, handler),
    getWindow: () => window,
    getController: () => controller,
    bodyEventIngress,
    handleAcceptedBodyEvent,
    getNativePosition: () => currentPosition,
    getScreenBounds: () => ({ id: 'primary', x: 0, y: 0, width: 1_920, height: 1_080 }),
    beginBrainTransaction,
    commitBrainTransaction,
    pivotOffset: { x: 50, y: 90 },
    compactSize: { width: 280, height: 320 },
    expandedSize: { width: 1_140, height: 620 },
  });

  const handler = (channel: string): RegisteredAutonomyIpcHandler => {
    const registered = handlers.get(channel);
    if (registered === undefined) throw new Error(`Missing handler: ${channel}`);
    return registered;
  };
  return {
    handler,
    trustedSender,
    window,
    controller,
    bodyEventIngress,
    handleAcceptedBodyEvent,
    beginBrainTransaction,
    commitBrainTransaction,
  };
}

describe('Main: autonomy IPC registration', () => {
  it('rejects foreign senders before any menu, autonomy, or sleep/wake mutation', async () => {
    const fixture = createRegistrationFixture();
    const foreignEvent = { sender: {} };

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
    expect(fixture.beginBrainTransaction).not.toHaveBeenCalled();
    expect(fixture.commitBrainTransaction).not.toHaveBeenCalled();
  });

  it('contains autonomy mutations in one Brain transaction', async () => {
    const fixture = createRegistrationFixture();
    const order: string[] = [];
    fixture.beginBrainTransaction.mockImplementation(() => order.push('begin'));
    fixture.controller.setEnabled.mockImplementation(() => order.push('mutation'));
    fixture.commitBrainTransaction.mockImplementation(() => order.push('commit'));

    await fixture.handler('wisp:set-autonomy-enabled')(
      { sender: fixture.trustedSender },
      { enabled: false }
    );

    expect(order).toEqual(['begin', 'mutation', 'commit']);
    expect(fixture.beginBrainTransaction).toHaveBeenCalledOnce();
    expect(fixture.commitBrainTransaction).toHaveBeenCalledOnce();
  });

  it('routes accepted Body payloads through ingress and one Brain transaction', async () => {
    const fixture = createRegistrationFixture();
    const event = { sender: fixture.trustedSender };
    const order: string[] = [];
    fixture.beginBrainTransaction.mockImplementation(() => order.push('begin'));
    fixture.handleAcceptedBodyEvent.mockImplementation(() => order.push('body-event'));
    fixture.commitBrainTransaction.mockImplementation(() => order.push('commit'));
    const payload = {
      streamId: 'stream-1', sequence: 1, basedOnRevision: 1, observedAtMs: 10,
      type: 'interaction', interaction: 'click',
    };

    await expect(fixture.handler('wisp:body-event')(event, payload)).resolves.toBeUndefined();
    expect(fixture.bodyEventIngress.receive).toHaveBeenCalledWith(payload);
    expect(fixture.handleAcceptedBodyEvent).toHaveBeenCalledWith(payload);
    expect(fixture.beginBrainTransaction).toHaveBeenCalledOnce();
    expect(fixture.commitBrainTransaction).toHaveBeenCalledOnce();
    expect(order).toEqual(['begin', 'body-event', 'commit']);
  });

  it('clamps right and bottom edges by expanded window size through the root command path', async () => {
    const fixture = createRegistrationFixture();

    await expect(fixture.handler('wisp:body-event')(
      { sender: fixture.trustedSender },
      bodyEvent('menu_visibility_changed')
    )).resolves.toBeUndefined();

    expect(fixture.controller.setMenuOpen).toHaveBeenCalledWith(true);
    expect(fixture.window.setSize).toHaveBeenCalledWith(1_140, 620);
    expect(fixture.controller.requestManualRootPosition).toHaveBeenCalledWith({ x: 830, y: 550 });
  });

  it('preserves a legal left/top position while resizing through the same root path', async () => {
    const fixture = createRegistrationFixture({ x: 0, y: 0 });

    await expect(fixture.handler('wisp:body-event')(
      { sender: fixture.trustedSender },
      bodyEvent('menu_visibility_changed')
    )).resolves.toBeUndefined();

    expect(fixture.controller.requestManualRootPosition).toHaveBeenCalledWith({ x: 50, y: 90 });
  });

  it('still resizes and keeps the current position when Motion rejects reposition', async () => {
    const currentPosition = { x: 1_600, y: 760 };
    const fixture = createRegistrationFixture(currentPosition);
    fixture.controller.requestManualRootPosition.mockReturnValue(false);

    await expect(fixture.handler('wisp:body-event')(
      { sender: fixture.trustedSender },
      bodyEvent('menu_visibility_changed')
    )).resolves.toBeUndefined();

    expect(fixture.controller.requestManualRootPosition).toHaveBeenCalledWith({ x: 830, y: 550 });
    expect(fixture.window.setResizable).toHaveBeenCalledWith(true);
    expect(fixture.window.setSize).toHaveBeenCalledWith(1_140, 620);
  });
});
