import { describe, expect, it, vi } from 'vitest';
import {
  handleBeginPetDrag,
  handleMovePetDrag,
  handleReleasePetDrag,
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
});
