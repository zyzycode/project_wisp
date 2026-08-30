import type {
  BeginPetDragDTO,
  BeginPetDragResultDTO,
  MovePetDragDTO,
  ReleasePetDragDTO,
} from '../shared/ipc-contracts';

export interface ShimejiMotionIpcController {
  beginDrag(input: BeginPetDragDTO): string | null;
  moveDrag(input: MovePetDragDTO): void;
  releaseDrag(input: ReleasePetDragDTO): void;
}

function isFinitePosition(value: unknown): value is { readonly x: number; readonly y: number } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<{ x: unknown; y: unknown }>;
  return typeof candidate.x === 'number' && Number.isFinite(candidate.x) && typeof candidate.y === 'number' && Number.isFinite(candidate.y);
}

export function isPetDragPointerDTO(value: unknown): value is BeginPetDragDTO {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<BeginPetDragDTO>;
  return (
    typeof candidate.pointerId === 'number' && Number.isInteger(candidate.pointerId) && candidate.pointerId >= 0 &&
    typeof candidate.sequence === 'number' && Number.isInteger(candidate.sequence) && candidate.sequence >= 0 &&
    isFinitePosition(candidate.screenPosition)
  );
}

export function isMovePetDragDTO(value: unknown): value is MovePetDragDTO {
  if (!isPetDragPointerDTO(value)) return false;
  const dragSessionId = (value as Partial<MovePetDragDTO>).dragSessionId;
  return typeof dragSessionId === 'string' && dragSessionId.length > 0;
}

export function handleBeginPetDrag(
  controller: ShimejiMotionIpcController,
  payload: unknown
): BeginPetDragResultDTO {
  if (!isPetDragPointerDTO(payload)) throw new TypeError('Invalid begin pet drag payload');
  const dragSessionId = controller.beginDrag(payload);
  if (dragSessionId === null) throw new Error('Pet drag session is unavailable');
  return { dragSessionId };
}

export function handleMovePetDrag(controller: ShimejiMotionIpcController, payload: unknown): void {
  if (!isMovePetDragDTO(payload)) throw new TypeError('Invalid move pet drag payload');
  controller.moveDrag(payload);
}

export function handleReleasePetDrag(controller: ShimejiMotionIpcController, payload: unknown): void {
  if (!isMovePetDragDTO(payload)) throw new TypeError('Invalid release pet drag payload');
  controller.releaseDrag(payload);
}
