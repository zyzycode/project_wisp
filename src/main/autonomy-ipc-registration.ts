import type { ScreenBoundsDto, Vector2Dto } from '../domain/behavior/motion-engine';
import { nativeToRootPosition } from '../infrastructure/adapters/electron-pet-position-adapter';
import type { PetPositionDTO } from '../shared/ipc-contracts';
import {
  handleRequestSleepWake,
  handleSetAutonomyEnabled,
  handleSetMenuExpanded,
  isTrustedIpcSender,
  type AutonomyIpcController,
  type MenuAutonomyController,
  type SleepWakeCommandController,
} from './shimeji-ipc-handlers';

export interface RegisteredAutonomyIpcEvent {
  readonly sender: object;
}

export type RegisteredAutonomyIpcHandler = (
  event: RegisteredAutonomyIpcEvent,
  payload: unknown
) => Promise<unknown>;

interface WindowSize {
  readonly width: number;
  readonly height: number;
}

interface AutonomyIpcWindow {
  readonly webContents: object;
  isDestroyed(): boolean;
  setResizable(resizable: boolean): void;
  setSize(width: number, height: number): void;
}

interface MainAutonomyIpcController
  extends AutonomyIpcController,
    MenuAutonomyController,
    SleepWakeCommandController {
  requestManualRootPosition(targetRootPosition: Vector2Dto): boolean;
}

export interface BodyEventIpcIngress {
  receive(payload: unknown): unknown;
}

export interface RegisterAutonomyIpcHandlersOptions {
  readonly register: (channel: string, handler: RegisteredAutonomyIpcHandler) => void;
  readonly getWindow: () => AutonomyIpcWindow | null;
  readonly getController: () => MainAutonomyIpcController | null;
  readonly bodyEventIngress: BodyEventIpcIngress;
  readonly getNativePosition: () => PetPositionDTO;
  readonly getScreenBounds: () => ScreenBoundsDto;
  readonly pivotOffset: Vector2Dto;
  readonly compactSize: WindowSize;
  readonly expandedSize: WindowSize;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clampNativePositionForWindow(
  position: PetPositionDTO,
  bounds: ScreenBoundsDto,
  size: WindowSize
): PetPositionDTO {
  const maxX = bounds.x + Math.max(0, bounds.width - size.width);
  const maxY = bounds.y + Math.max(0, bounds.height - size.height);
  return {
    x: Math.round(clamp(position.x, bounds.x, maxX)),
    y: Math.round(clamp(position.y, bounds.y, maxY)),
  };
}

function requireTrustedWindow(
  options: RegisterAutonomyIpcHandlersOptions,
  event: RegisteredAutonomyIpcEvent
): AutonomyIpcWindow {
  const window = options.getWindow();
  if (
    window === null ||
    window.isDestroyed() ||
    !isTrustedIpcSender(event.sender, window.webContents)
  ) {
    throw new TypeError('Untrusted autonomy IPC sender');
  }
  return window;
}

function requireTrustedContext(
  options: RegisterAutonomyIpcHandlersOptions,
  event: RegisteredAutonomyIpcEvent
): { readonly window: AutonomyIpcWindow; readonly controller: MainAutonomyIpcController } {
  const window = requireTrustedWindow(options, event);
  const controller = options.getController();
  if (controller === null) throw new Error('Autonomy is unavailable');
  return { window, controller };
}

export function registerAutonomyIpcHandlers(options: RegisterAutonomyIpcHandlersOptions): void {
  options.register('wisp:set-menu-expanded', async (event, payload): Promise<PetPositionDTO> => {
    const { window, controller } = requireTrustedContext(options, event);
    const expanded = handleSetMenuExpanded(controller, payload);
    const size = expanded ? options.expandedSize : options.compactSize;
    const currentPosition = options.getNativePosition();
    const nextPosition = clampNativePositionForWindow(
      currentPosition,
      options.getScreenBounds(),
      size
    );
    const repositionAccepted = controller.requestManualRootPosition(
      nativeToRootPosition(nextPosition, options.pivotOffset)
    );
    window.setResizable(true);
    window.setSize(size.width, size.height);
    return repositionAccepted ? nextPosition : currentPosition;
  });

  options.register('wisp:set-autonomy-enabled', async (event, payload): Promise<void> => {
    const { controller } = requireTrustedContext(options, event);
    handleSetAutonomyEnabled(controller, payload);
  });

  options.register('wisp:request-sleep-wake', async (event, payload): Promise<void> => {
    const { controller } = requireTrustedContext(options, event);
    handleRequestSleepWake(controller, payload);
  });

  options.register('wisp:body-event', async (event, payload): Promise<void> => {
    requireTrustedWindow(options, event);
    options.bodyEventIngress.receive(payload);
  });
}
