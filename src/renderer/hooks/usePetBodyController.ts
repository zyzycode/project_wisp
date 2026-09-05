import { useCallback, useEffect, useRef, useState } from 'react';
import type { BodyInteractionTypeDTO, WispApiBridge } from '../../shared/ipc-contracts';
import {
  PetBodyController,
  type PetBodySnapshot,
} from '../pet-body-controller';

export interface UsePetBodyControllerResult {
  readonly controller: PetBodyController;
  readonly snapshot: PetBodySnapshot | null;
  readonly postInteraction: (interaction: BodyInteractionTypeDTO, intensity?: number) => boolean;
}

/** Owns one Body lifecycle for the current Renderer document subscription. */
export function usePetBodyController(
  bridge: Pick<WispApiBridge, 'onBrainState' | 'postBodyEvent'>
): UsePetBodyControllerResult {
  const controllerRef = useRef<PetBodyController | null>(null);
  if (controllerRef.current === null) controllerRef.current = new PetBodyController(bridge);
  const controller = controllerRef.current;
  const [snapshot, setSnapshot] = useState<PetBodySnapshot | null>(null);

  useEffect(() => controller.subscribe(setSnapshot), [controller]);

  const postInteraction = useCallback(
    (interaction: BodyInteractionTypeDTO, intensity?: number): boolean =>
      controller.postInteraction(interaction, intensity),
    [controller]
  );

  return { controller, snapshot, postInteraction };
}
