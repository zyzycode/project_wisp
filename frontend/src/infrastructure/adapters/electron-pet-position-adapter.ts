import type { BrowserWindow } from 'electron';
import type { PetPositionPort } from '../../application/ports/pet-position-port';
import type { ScreenBoundsDto, Vector2Dto } from '../../domain/behavior/motion-engine';

export type BrowserWindowGetter = () => BrowserWindow | null;

export interface ElectronPetPositionAdapterOptions {
  readonly getWindow: BrowserWindowGetter;
  readonly pivotOffset: Vector2Dto;
}

interface NativeWindowPosition {
  readonly x: number;
  readonly y: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function rootToNativePosition(
  rootPosition: Vector2Dto,
  bounds: ScreenBoundsDto,
  pivotOffset: Vector2Dto
): NativeWindowPosition {
  return {
    x: Math.round(clamp(rootPosition.x - pivotOffset.x, bounds.x, bounds.x + bounds.width)),
    y: Math.round(clamp(rootPosition.y - pivotOffset.y, bounds.y, bounds.y + bounds.height)),
  };
}

export function nativeToRootPosition(
  nativePosition: NativeWindowPosition,
  pivotOffset: Vector2Dto
): Vector2Dto {
  return {
    x: nativePosition.x + pivotOffset.x,
    y: nativePosition.y + pivotOffset.y,
  };
}

/** Converts the logical root pivot into the native top-left window position. */
export class ElectronPetPositionAdapter implements PetPositionPort {
  private lastWindow: BrowserWindow | null = null;
  private lastPosition: NativeWindowPosition | null = null;

  public constructor(private readonly options: ElectronPetPositionAdapterOptions) {}

  public commitRootPosition(input: {
    readonly rootPosition: Vector2Dto;
    readonly bounds: ScreenBoundsDto;
  }): void {
    const window = this.options.getWindow();
    if (window === null || window.isDestroyed()) {
      return;
    }

    const nextPosition = this.toNativePosition(input.rootPosition, input.bounds);
    if (
      window === this.lastWindow &&
      this.lastPosition !== null &&
      this.lastPosition.x === nextPosition.x &&
      this.lastPosition.y === nextPosition.y
    ) {
      return;
    }

    window.setPosition(nextPosition.x, nextPosition.y);
    this.lastWindow = window;
    this.lastPosition = nextPosition;
  }

  private toNativePosition(
    rootPosition: Vector2Dto,
    bounds: ScreenBoundsDto
  ): NativeWindowPosition {
    return rootToNativePosition(rootPosition, bounds, this.options.pivotOffset);
  }
}
