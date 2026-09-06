import React from 'react';
import { useDesktopPetController } from '../hooks/useDesktopPetController';
import { PetOverlay } from './PetOverlay';

/** Renderer owns Body and UI only; provider execution belongs to Main. */
export const DesktopPet: React.FC = () => {
  const model = useDesktopPetController({ bridge: window.wispAPI });
  return <PetOverlay model={model} />;
};
