import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PetBodyController } from '../pet-body-controller';
import {
  LatestAnimationFrameQueue,
  registerPetDragGlobalListeners,
  type ListenerTarget,
  type PetDragGlobalHandlers,
  type PetPointerEvent,
} from '../body-ui-runtime';

interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

interface DragFrame {
  readonly point: ScreenPoint;
  readonly deltaX: number;
  readonly deltaY: number;
}

interface PressState {
  readonly pointerId: number;
  readonly origin: ScreenPoint;
  last: ScreenPoint;
}

interface GestureState {
  readonly pointerId: number;
  readonly gestureId: string;
}

export interface UsePetDragControllerOptions {
  readonly controller: PetBodyController;
  readonly onDragStarted?: () => void;
  readonly onDragEnded?: () => void;
}

export interface UsePetDragControllerResult {
  readonly isDragging: boolean;
  readonly onPointerDown: (event: ReactPointerEvent) => void;
  readonly consumeClickSuppression: () => boolean;
}

const DRAG_THRESHOLD_PX = 4;

/** Owns global pointer capture, one causal gesture, RAF coalescing, and teardown. */
export function usePetDragController({
  controller,
  onDragStarted,
  onDragEnded,
}: UsePetDragControllerOptions): UsePetDragControllerResult {
  const [isDragging, setIsDragging] = useState(false);
  const pressRef = useRef<PressState | null>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const queue = new LatestAnimationFrameQueue<DragFrame>(
      {
        request: (callback) => window.requestAnimationFrame(callback),
        cancel: (frameId) => window.cancelAnimationFrame(frameId),
      },
      ({ point, deltaX, deltaY }) => {
        const gesture = gestureRef.current;
        if (gesture === null) return;
        controller.moveDrag(gesture.gestureId, gesture.pointerId, point);
        const stretch = Math.min(0.08, Math.hypot(deltaX, deltaY) / 160);
        controller.setDragReflex({
          scaleX: 1 + stretch,
          scaleY: 1 - stretch,
          rotationDeg: Math.max(-25, Math.min(25, deltaX * 0.5)),
        });
      }
    );
    const finish = (event: PetPointerEvent, cancelled: boolean): void => {
      const press = pressRef.current;
      if (press === null || press.pointerId !== event.pointerId) return;
      const gesture = gestureRef.current;
      pressRef.current = null;
      queue.clear();
      if (gesture !== null) {
        controller.endDrag(
          gesture.gestureId,
          gesture.pointerId,
          { x: event.screenX, y: event.screenY },
          cancelled
        );
        gestureRef.current = null;
        controller.setDragReflex({ scaleX: 1, scaleY: 1, rotationDeg: 0 });
        setIsDragging(false);
        onDragEnded?.();
      }
    };

    const move = (event: PetPointerEvent): void => {
      const press = pressRef.current;
      if (press === null || press.pointerId !== event.pointerId) return;
      const point = { x: event.screenX, y: event.screenY };
      const deltaX = point.x - press.last.x;
      const deltaY = point.y - press.last.y;
      press.last = point;
      if (gestureRef.current === null) {
        const totalX = point.x - press.origin.x;
        const totalY = point.y - press.origin.y;
        if (Math.abs(totalX) <= DRAG_THRESHOLD_PX && Math.abs(totalY) <= DRAG_THRESHOLD_PX) return;
        const gestureId = controller.beginDrag(event.pointerId, point);
        if (gestureId === null) return;
        gestureRef.current = { gestureId, pointerId: event.pointerId };
        suppressClickRef.current = true;
        setIsDragging(true);
        onDragStarted?.();
      }
      queue.push({ point, deltaX, deltaY });
    };

    const handlers: PetDragGlobalHandlers = {
      move,
      end: (event) => finish(event, false),
      cancel: (event) => finish(event, true),
    };
    const removeListeners = registerPetDragGlobalListeners(
      window as unknown as ListenerTarget,
      handlers
    );
    return (): void => {
      removeListeners();
      const gesture = gestureRef.current;
      const press = pressRef.current;
      if (gesture !== null && press !== null) {
        controller.endDrag(
          gesture.gestureId,
          gesture.pointerId,
          press.last,
          true
        );
      }
      pressRef.current = null;
      gestureRef.current = null;
      queue.dispose();
      controller.setDragReflex({ scaleX: 1, scaleY: 1, rotationDeg: 0 });
    };
  }, [controller, onDragEnded, onDragStarted]);

  const onPointerDown = useCallback((event: ReactPointerEvent): void => {
    if (event.button !== 0 || pressRef.current !== null) return;
    suppressClickRef.current = false;
    const point = { x: event.screenX, y: event.screenY };
    pressRef.current = { pointerId: event.pointerId, origin: point, last: point };
  }, []);

  const consumeClickSuppression = useCallback((): boolean => {
    const suppressed = suppressClickRef.current;
    suppressClickRef.current = false;
    return suppressed;
  }, []);

  return { isDragging, onPointerDown, consumeClickSuppression };
}
