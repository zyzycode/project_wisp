import type {
  SleepWakeCommandDTO,
} from '../shared/ipc-contracts';

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

export function handleMenuVisibilityChanged(
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
