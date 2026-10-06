import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { WispApiBridge } from '../../shared/ipc-contracts';
import type { PetBodyController } from '../pet-body-controller';
import {
  registerOverlayMouseListener,
  shouldIgnoreOverlayPointer,
  type ListenerTarget,
  type OverlayDocument,
} from '../body-ui-runtime';

export interface UseWindowOverlayOptions {
  readonly bridge: Pick<WispApiBridge, 'setIgnoreMouseEvents'>;
  readonly controller: PetBodyController;
  readonly forceInteractive?: boolean;
}

export interface UseWindowOverlayResult {
  readonly menuOpen: boolean;
  readonly setMenuOpen: Dispatch<SetStateAction<boolean>>;
}

/** Owns native click-through mode and menu-size observation for the overlay window. */
export function useWindowOverlay({
  bridge,
  controller,
  forceInteractive = false,
}: UseWindowOverlayOptions): UseWindowOverlayResult {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(menuOpen);
  const requestedIgnoreRef = useRef<boolean | null>(null);
  const requestGenerationRef = useRef(0);
  const firstMenuEffectRef = useRef(true);

  menuOpenRef.current = menuOpen;
  const requestMouseMode = useCallback((ignore: boolean): void => {
    if (requestedIgnoreRef.current === ignore) return;
    requestedIgnoreRef.current = ignore;
    const generation = ++requestGenerationRef.current;
    void bridge.setIgnoreMouseEvents({ ignore, forward: true }).catch(() => {
      if (generation !== requestGenerationRef.current || !ignore) return;
      requestedIgnoreRef.current = false;
      return bridge.setIgnoreMouseEvents({ ignore: false });
    });
  }, [bridge]);

  useEffect(() => {
    if (firstMenuEffectRef.current) {
      firstMenuEffectRef.current = false;
      return;
    }
    controller.postMenuVisibility(menuOpen);
  }, [controller, menuOpen]);

  useEffect(() => {
    const canHitTest = typeof document.elementFromPoint === 'function';
    const forced = forceInteractive || menuOpen;
    if (!canHitTest) {
      requestMouseMode(false);
      return undefined;
    }
    requestMouseMode(!forced);
    const removeListener = registerOverlayMouseListener(window as unknown as ListenerTarget, (event) => {
      requestMouseMode(shouldIgnoreOverlayPointer(
        forced,
        document as unknown as OverlayDocument,
        event.clientX,
        event.clientY
      ));
    });
    return (): void => removeListener();
  }, [forceInteractive, menuOpen, requestMouseMode]);

  useEffect(() => () => {
    requestGenerationRef.current += 1;
    requestedIgnoreRef.current = false;
    void bridge.setIgnoreMouseEvents({ ignore: false }).catch(() => undefined);
    if (menuOpenRef.current) controller.postMenuVisibility(false);
  }, [bridge, controller]);

  return { menuOpen, setMenuOpen };
}
