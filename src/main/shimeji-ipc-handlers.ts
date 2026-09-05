import type {
  BeginPetDragDTO,
  BeginPetDragResultDTO,
  MovePetDragDTO,
  ReleasePetDragDTO,
  SleepWakeCommandDTO,
} from '../shared/ipc-contracts';

export interface ShimejiMotionIpcController {
  beginDrag(input: BeginPetDragDTO): string | null;
  moveDrag(input: MovePetDragDTO): void;
  releaseDrag(input: ReleasePetDragDTO): void;
}

export interface AutonomyIpcController {
  setEnabled(enabled: boolean): void;
}

export interface MenuAutonomyController {
  setMenuOpen(menuOpen: boolean): void;
}

export interface SleepWakeCommandController {
  requestSleepWake(command: SleepWakeCommandDTO): void;
}

export function isTrustedIpcSender(sender: object, expectedSender: object | null): boolean {
  return expectedSender !== null && sender === expectedSender;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function handleRequestSleepWake(
  controller: SleepWakeCommandController,
  payload: unknown
): void {
  if (!isPlainObject(payload) || (payload.action !== 'sleep' && payload.action !== 'wake')) {
    throw new TypeError('Invalid sleep/wake command payload');
  }
  controller.requestSleepWake({ action: payload.action });
}

export function handleSetMenuExpanded(
  controller: MenuAutonomyController | null,
  expanded: unknown
): boolean {
  if (typeof expanded !== 'boolean') throw new TypeError('Invalid menu expanded value');
  controller?.setMenuOpen(expanded);
  return expanded;
}

export function handleSetAutonomyEnabled(
  controller: AutonomyIpcController,
  payload: unknown
): void {
  if (
    !isPlainObject(payload) ||
    Object.keys(payload).length !== 1 ||
    !Object.hasOwn(payload, 'enabled')
  ) {
    throw new TypeError('Invalid autonomy payload');
  }
  if (typeof payload.enabled !== 'boolean') {
    throw new TypeError('Invalid autonomy enabled value');
  }
  controller.setEnabled(payload.enabled);
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
