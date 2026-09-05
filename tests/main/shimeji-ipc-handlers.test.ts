import { describe, expect, it, vi } from 'vitest';
import {
  handleBeginPetDrag,
  handleMovePetDrag,
  handleReleasePetDrag,
  handleRequestSleepWake,
  handleSetAutonomyEnabled,
  handleSetMenuExpanded,
  isTrustedIpcSender,
  isMovePetDragDTO,
  isPetDragPointerDTO,
} from '../../src/main/shimeji-ipc-handlers';

function controller() {
  return { beginDrag: vi.fn((): string | null => 'session-42'), moveDrag: vi.fn(), releaseDrag: vi.fn() };
}

const beginPayload = { pointerId: 2, sequence: 0, screenPosition: { x: 100, y: 200 } };
const movePayload = { ...beginPayload, sequence: 1, dragSessionId: 'session-42' };

describe('Main: Shimeji IPC handlers', () => {
  it('validates serializable pointer payloads', () => {
    expect(isPetDragPointerDTO(beginPayload)).toBe(true);
    expect(isPetDragPointerDTO({ ...beginPayload, sequence: -1 })).toBe(false);
    expect(isPetDragPointerDTO({ ...beginPayload, screenPosition: { x: Number.NaN, y: 1 } })).toBe(false);
    expect(isMovePetDragDTO(movePayload)).toBe(true);
    expect(isMovePetDragDTO({ ...movePayload, dragSessionId: '' })).toBe(false);
  });

  it('starts a session and routes valid move/release payloads to the orchestrator', () => {
    const target = controller();

    expect(handleBeginPetDrag(target, beginPayload)).toEqual({ dragSessionId: 'session-42' });
    handleMovePetDrag(target, movePayload);
    handleReleasePetDrag(target, movePayload);

    expect(target.beginDrag).toHaveBeenCalledWith(beginPayload);
    expect(target.moveDrag).toHaveBeenCalledWith(movePayload);
    expect(target.releaseDrag).toHaveBeenCalledWith(movePayload);
  });

  it('rejects malformed payloads and an unavailable new session', () => {
    const target = controller();
    target.beginDrag.mockReturnValueOnce(null);

    expect(() => handleBeginPetDrag(target, { pointerId: 'bad' })).toThrow(TypeError);
    expect(() => handleMovePetDrag(target, beginPayload)).toThrow(TypeError);
    expect(() => handleReleasePetDrag(target, { ...movePayload, sequence: 1.5 })).toThrow(TypeError);
    expect(() => handleBeginPetDrag(target, beginPayload)).toThrow('unavailable');
  });

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
    expect(handleSetMenuExpanded(autonomy, true)).toBe(true);
    expect(handleSetMenuExpanded(autonomy, false)).toBe(false);
    expect(autonomy.setMenuOpen).toHaveBeenNthCalledWith(1, true);
    expect(autonomy.setMenuOpen).toHaveBeenNthCalledWith(2, false);
    expect(() => handleSetMenuExpanded(autonomy, 'true')).toThrow(TypeError);
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
