import { describe, expect, it, vi } from 'vitest';
import {
  handleRequestSleepWake,
  handleSetAutonomyEnabled,
  handleMenuVisibilityChanged,
  isTrustedIpcSender,
} from '../../src/main/shimeji-ipc-handlers';

describe('Main: Shimeji IPC handlers', () => {
  it('validates and routes the autonomy toggle', () => {
    const autonomy = { setEnabled: vi.fn() };

    handleSetAutonomyEnabled(autonomy, { enabled: false });

    expect(autonomy.setEnabled).toHaveBeenCalledWith(false);
    expect(() => handleSetAutonomyEnabled(autonomy, { enabled: 'false' })).toThrow(TypeError);
    expect(() => handleSetAutonomyEnabled(autonomy, { enabled: false, extra: true })).toThrow(TypeError);
    expect(() => handleSetAutonomyEnabled(autonomy, Object.create({ enabled: false }))).toThrow(TypeError);
    expect(() => handleSetAutonomyEnabled(autonomy, null)).toThrow(TypeError);
  });

  it('validates and routes the menu pause state to autonomy', () => {
    const autonomy = { setMenuOpen: vi.fn() };
    expect(handleMenuVisibilityChanged(autonomy, true)).toBe(true);
    expect(handleMenuVisibilityChanged(autonomy, false)).toBe(false);
    expect(autonomy.setMenuOpen).toHaveBeenNthCalledWith(1, true);
    expect(autonomy.setMenuOpen).toHaveBeenNthCalledWith(2, false);
    expect(() => handleMenuVisibilityChanged(autonomy, 'true')).toThrow(TypeError);
  });

  it('accepts sleep/wake commands only from the trusted sender and normalizes payloads', () => {
    const expectedSender = {};
    const controller = { requestSleepWake: vi.fn() };

    expect(isTrustedIpcSender(expectedSender, expectedSender)).toBe(true);
    expect(isTrustedIpcSender({}, expectedSender)).toBe(false);
    expect(isTrustedIpcSender(expectedSender, null)).toBe(false);

    const sleepPayload = { action: 'sleep', ignored: 'extra' };
    handleRequestSleepWake(controller, sleepPayload);
    handleRequestSleepWake(controller, { action: 'wake' });

    expect(controller.requestSleepWake).toHaveBeenNthCalledWith(1, { action: 'sleep' });
    expect(controller.requestSleepWake.mock.calls[0]?.[0]).not.toBe(sleepPayload);
    expect(controller.requestSleepWake).toHaveBeenNthCalledWith(2, { action: 'wake' });
    for (const malformed of [null, [], { action: 'nap' }, { action: 1 }, Object.create({ action: 'sleep' })]) {
      expect(() => handleRequestSleepWake(controller, malformed)).toThrow(TypeError);
    }
  });
});
